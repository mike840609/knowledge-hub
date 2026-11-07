import { performance } from "node:perf_hooks";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbTaskKnowledgeUnitOfWork } from "@/infrastructure/database/mariadb/task-knowledge-transaction";
import { ManageExportBindingService } from "@/modules/task-knowledge/application/manage-export-binding";
import { buildTaskSearchSql } from "@/infrastructure/database/mariadb/repositories/task-search-sql";
import { parseTaskSearchQuery } from "@/modules/task-knowledge/domain/task-search-query";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import { uuidv7 } from "@/shared/ids/uuidv7";
import { seedMySpace } from "./task-knowledge-fixtures";

/** Opt-in large-dataset integration benchmark.
 * Set KM_TASK_SEARCH_PERF=1 against the test MariaDB target.
 * Real owner-scoped SQL with a synthetic 10k task dataset; no production SLA
 * claims can be drawn from CI metrics.
 */
const benchIt = process.env.KM_TASK_SEARCH_PERF === "1" ? it : it.skip;
let pool: Pool;
beforeAll(() => { pool = createDatabasePool(databaseConfig("test")); });
afterAll(async () => { await pool?.end(); });

describe("Task Search SQL performance (10k rows / owner)", () => {
  benchIt("records scoped EXPLAIN and search p95 at 100, 1k, and 10k", async () => {
    const {owner,workspaceId} = await seedMySpace(pool,"Task Search SQL Bench");
    const {bindingId} = await new ManageExportBindingService(
      new MariaDbTaskKnowledgeUnitOfWork(pool),
    ).create(callerFromIdentity(owner), {workspaceId, label:"Benchmark binding"});
    const targets = [100, 1000, 10000];
    let count = 0;
    const baseDate = Date.parse("2026-11-06T12:00:00Z");
    const summary = "Indexed task summary: scope, agent provenance, decision context, lifecycle. ".repeat(2);
    const variants = [
      { name:"no_filters", query:parseTaskSearchQuery({}) },
      { name:"one_keyword", query:parseTaskSearchQuery({q:"security"}) },
      { name:"combined", query:parseTaskSearchQuery({
        q:"security authorization", agent:"opencode", verification:"passed",
        from:"2026-11-06",to:"2026-11-06",offset:"480",
      }) },
    ];
    const snapshots: Array<{
      rows: number; shape: string; p95Ms: number; maxMs: number; selected: number;
      explain: Array<{table:string;type:string;key:string|null;rows:number;extra:string|null}>;
    }> = [];
    try {
      for (const target of targets) {
        while (count < target) {
          const size = Math.min(250,target-count);
          const batch = Array.from({length:size},(_,offset)=>{
            const i = count + offset;
            const match = i % 4 === 0;
            const id = uuidv7();
            const title = (match ? "security authorization task " : "ordinary analysis task ") + i;
            const search = (match ? "security authorization; " : "general notes; ") + summary;
            return {id, taskId:"bench-"+i,title,search,
              agent: i % 2 === 0 ? "opencode" : "claude-code",
              verification: i % 3 === 0 ? "passed" : "failed",
              completedAt:baseDate + i * 1000};
          });
          await pool.batch(
            "INSERT INTO task_results (id,binding_id,task_id,latest_revision_no) VALUES (?,?,?,1)",
            batch.map(row=>[row.id,bindingId,row.taskId]),
          );
          await pool.batch(
            "INSERT INTO task_result_search (task_result_id,revision_no,completed_at_epoch_ms,agent,verification_status,title,summary,search_body) VALUES (?,1,?,?,?,?,?,?)",
            batch.map(row=>[row.id,row.completedAt,row.agent,row.verification,row.title,summary,row.search]),
          );
          count += size;
        }
        for (const {name,query} of variants) {
          const built = buildTaskSearchSql(workspaceId,owner.id,query,null,51);
          const explained = built.sql.replace(/^SET STATEMENT max_statement_time=5 FOR\s*/,"EXPLAIN ");
          const plan = await pool.query<Array<{table:string;type:string;key:string|null;rows:number;Extra?:string|null}>>(explained,built.params);
          const elapsed: number[] = [];
          let selected = 0;
          for(let attempt=0;attempt<5;attempt++){
            const start=performance.now();
            const rows=await pool.query<Array<{task_result_id:string}>>(built.sql,built.params);
            elapsed.push(performance.now()-start);
            selected=rows.length;
          }
          elapsed.sort((a,b)=>a-b);
          const p95Ms=Number(elapsed[Math.ceil(elapsed.length*0.95)-1].toFixed(2));
          snapshots.push({
            rows:target,shape:name,p95Ms,maxMs:Number(elapsed.at(-1)!.toFixed(2)),selected,
            explain:plan.map(row=>({
              table:row.table,type:row.type,key:row.key,rows:Number(row.rows),extra:row.Extra??null,
            })),
          });
          expect(selected).toBeGreaterThan(0);
          expect(p95Ms).toBeLessThan(5000);
        }
      }
      console.info("TASK_SEARCH_PERF_100_1000_10000",JSON.stringify({
        server:"MariaDB 10.11 integration test",recordsAre:"synthetic",samplesPerShape:5,
        statementTimeoutSeconds:5,snapshots,
      }));
      expect(snapshots).toHaveLength(9);
    } finally {
      await pool.query(
        "DELETE FROM task_result_search WHERE task_result_id IN (SELECT id FROM task_results WHERE binding_id = ?)",
        [bindingId],
      );
      await pool.query("DELETE FROM task_results WHERE binding_id = ?",[bindingId]);
    }
  },240_000);
});


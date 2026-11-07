import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Pool } from "mariadb";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { MariaDbTaskKnowledgeUnitOfWork } from "@/infrastructure/database/mariadb/task-knowledge-transaction";
import { ManageExportBindingService } from "@/modules/task-knowledge/application/manage-export-binding";
import { IngestTaskResultService } from "@/modules/task-knowledge/application/ingest-task-result";
import { TaskResultReadService } from "@/modules/task-knowledge/application/read-task-results";
import { parseTaskSearchQuery } from "@/modules/task-knowledge/domain/task-search-query";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import { backfillTaskSearch, checkTaskSearchConsistency } from "../../scripts/db/backfill-task-search";
import { seedMySpace } from "./task-knowledge-fixtures";
import { uuidv7 } from "@/shared/ids/uuidv7";
import { buildTaskSearchSql } from "@/infrastructure/database/mariadb/repositories/task-search-sql";

let pool: Pool;
beforeAll(() => { pool = createDatabasePool(databaseConfig("test")); });
afterAll(async () => { vi.unstubAllEnvs(); await pool?.end(); });

const artifactBase = JSON.parse(readFileSync(path.join(process.cwd(), "tests/fixtures/task-artifact/artifact/valid.json"), "utf8"));
const uow = () => new MariaDbTaskKnowledgeUnitOfWork(pool);

async function setup() {
  const { owner, workspaceId } = await seedMySpace(pool);
  const caller = callerFromIdentity(owner);
  const { token, bindingId } = await new ManageExportBindingService(uow()).create(caller, {workspaceId,label:"Task fixture"});
  const ingest = async (taskId: string, artifactRevision: number, summary: string, extra: Record<string,unknown>={}) =>
    new IngestTaskResultService(uow()).ingest(token, new TextEncoder().encode(JSON.stringify({
      ...artifactBase, taskId, artifactRevision, summary, ...extra,
    })));
  const read = new TaskResultReadService(uow());
  return {caller,workspaceId,bindingId,ingest,read};
}

describe("task search/backfill operational safety", () => {
  it("recovers missing projections in bounded batches and can rerun safely", async () => {
    const { ingest, bindingId, workspaceId } = await setup();
    // Staging task rows without any accepted revision are invisible to the legacy Tasks reader.
    const placeholderId = await uow().run((r) => r.taskExports.insertTaskIfAbsent({
      id: uuidv7(), bindingId, taskId: randomUUID(),
    }));
    const ids = [randomUUID(), randomUUID()];
    const results = await Promise.all(ids.map((id, i) => ingest(id, 1, "Backfill-"+i)));
    for (const r of results) {
      await pool.query("DELETE FROM task_result_search WHERE task_result_id = ?", [r.taskResultId]);
    }
    const before = await checkTaskSearchConsistency(pool, workspaceId);
    expect(before.missing).toBeGreaterThanOrEqual(2);
    const partial = await backfillTaskSearch(pool, { batchSize: 1, maxBatches: 1, workspaceId });
    expect(partial.indexed).toBe(1);
    const completed = await backfillTaskSearch(pool, { batchSize: 1, workspaceId });
    expect(completed.complete).toBe(true);
    const [staged] = await pool.query<{ count: number }[]>(
      "SELECT COUNT(*) AS count FROM task_result_search WHERE task_result_id = ?", [placeholderId],
    );
    expect(Number(staged.count)).toBe(0);
    const again = await backfillTaskSearch(pool, { batchSize: 1, workspaceId });
    expect(again.indexed).toBe(0);
    for (const r of results) {
      const [row] = await pool.query<{revision_no:number;summary:string}[]>("SELECT revision_no, summary FROM task_result_search WHERE task_result_id=?", [r.taskResultId]);
      expect(Number(row.revision_no)).toBe(1);
      expect(row.summary).toContain("Backfill");
    }
  });

  it("keeps newest committed revision when real ingest races bounded backfill", async () => {
    const { ingest, workspaceId } = await setup();
    const taskId = randomUUID();
    const first = await ingest(taskId, 1, "old revision");
    await pool.query("DELETE FROM task_result_search WHERE task_result_id = ?", [first.taskResultId]);
    await Promise.all([
      backfillTaskSearch(pool, { workspaceId, batchSize: 1, maxBatches: 1 }),
      ingest(taskId, 2, "concurrent revision 2"),
    ]);
    const [row] = await pool.query<{ revision_no: number; summary: string }[]>(
      "SELECT revision_no, summary FROM task_result_search WHERE task_result_id = ?", [first.taskResultId],
    );
    expect(Number(row.revision_no)).toBe(2);
    expect(row.summary).toBe("concurrent revision 2");
    expect((await checkTaskSearchConsistency(pool, workspaceId)).complete).toBe(true);
  });

  it("pages 50+ tied-millisecond Tasks without duplicates and verifies a scoped EXPLAIN", async () => {
    vi.stubEnv("TASK_SEARCH_READ_ENABLED", "true");
    const { caller, workspaceId, ingest, read } = await setup();
    const taskIds = Array.from({length: 52}, () => randomUUID());
    // Bounded concurrent real writes, not mocked repositories.
    for (let start = 0; start < taskIds.length; start += 8) {
      await Promise.all(taskIds.slice(start, start + 8).map((id) => ingest(id, 1, "pagination-match")));
    }
    const query = parseTaskSearchQuery({q:"pagination-match"});
    const firstPage = await read.list(caller, workspaceId, {search:query});
    expect(firstPage.items).toHaveLength(50);
    expect(firstPage.nextCursor).toBeTruthy();
    const secondPage = await read.list(caller, workspaceId, {search:query,cursor:firstPage.nextCursor});
    expect(secondPage.items).toHaveLength(2);
    expect(secondPage.nextCursor).toBeNull();
    const ids = [...firstPage.items,...secondPage.items].map((item) => item.taskResultId);
    expect(new Set(ids).size).toBe(52);

    // E2E SQL can be explained on the seeded tenant; do not treat this
    // tiny fixture as representative latency evidence for 1k/10k Tasks.
    const built = buildTaskSearchSql(workspaceId, caller.identity.id, query, null, 51);
    const explained = built.sql.replace(/^SET STATEMENT max_statement_time=5 FOR\s*/, "EXPLAIN ");
    const plan = await pool.query<{ table: string; type: string; key: string | null }[]>(explained, built.params);
    expect(plan.length).toBeGreaterThan(0);
    console.info("TASK_SEARCH_EXPLAIN_52", JSON.stringify(plan.map(({table,type,key}) => ({table,type,key}))));
  }, 120_000);

  it("owner-scoped search enforces filters, literal punctuation and latest revision", async () => {
    vi.stubEnv("TASK_SEARCH_READ_ENABLED","true");
    const {caller,workspaceId,ingest,read} = await setup();
    const taskId = randomUUID();
    const first = await ingest(taskId,1,"Old summary");
    await ingest(taskId,2,"安全 100%_! final", {title:"Credential search"});
    const second = await ingest(randomUUID(),1,"Unrelated", {title:"Other task"});
    const q = parseTaskSearchQuery({q:"安全 100%_!",agent:"opencode"});
    const page = await read.list(caller,workspaceId,{search:q});
    expect(page.items.map(x=>x.taskResultId)).toEqual([first.taskResultId]);
    expect(page.hasTasksInLifecycle).toBe(true);
    const none=await read.list(caller,workspaceId,{search:parseTaskSearchQuery({q:"NoSuchKeyword987"})});
    expect(none.items).toEqual([]);
    expect(none.hasTasksInLifecycle).toBe(true);
    const foreign = await setup();
    const outsider = await read.list(foreign.caller,foreign.workspaceId,{search:parseTaskSearchQuery({q:"安全"})});
    expect(outsider.items).not.toContainEqual(expect.objectContaining({taskResultId:first.taskResultId}));
    expect(second.taskResultId).not.toBe(first.taskResultId);
  });
});


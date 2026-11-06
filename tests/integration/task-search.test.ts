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

let pool: Pool;
beforeAll(() => { pool = createDatabasePool(databaseConfig("test")); });
afterAll(async () => { vi.unstubAllEnvs(); await pool?.end(); });

const artifactBase = JSON.parse(readFileSync(path.join(process.cwd(), "tests/fixtures/task-artifact/artifact/valid.json"), "utf8"));
const uow = () => new MariaDbTaskKnowledgeUnitOfWork(pool);

async function setup() {
  const { owner, workspaceId } = await seedMySpace(pool);
  const caller = callerFromIdentity(owner);
  const { token } = await new ManageExportBindingService(uow()).create(caller, {workspaceId,label:"Task fixture"});
  const ingest = async (taskId: string, artifactRevision: number, summary: string, extra: Record<string,unknown>={}) =>
    new IngestTaskResultService(uow()).ingest(token, new TextEncoder().encode(JSON.stringify({
      ...artifactBase, taskId, artifactRevision, summary, ...extra,
    })));
  const read = new TaskResultReadService(uow());
  return {caller,workspaceId,ingest,read};
}

describe("task search/backfill operational safety", () => {
  it("recovers missing projections in bounded batches and can rerun safely", async () => {
    const { ingest } = await setup();
    const ids = [randomUUID(), randomUUID()];
    const results = await Promise.all(ids.map((id, i) => ingest(id, 1, "Backfill-"+i)));
    for (const r of results) {
      await pool.query("DELETE FROM task_result_search WHERE task_result_id = ?", [r.taskResultId]);
    }
    const before = await checkTaskSearchConsistency(pool);
    expect(before.missing).toBeGreaterThanOrEqual(2);
    const partial = await backfillTaskSearch(pool, { batchSize: 1, maxBatches: 1 }).catch((error: unknown) => { console.error('BACKFILL_CAUSE', error instanceof Error ? error.cause : error); throw error; });
    expect(partial.indexed).toBe(1);
    const completed = await backfillTaskSearch(pool, { batchSize: 1 });
    expect(completed.complete).toBe(true);
    const again = await backfillTaskSearch(pool, { batchSize: 1 });
    expect(again.indexed).toBe(0);
    for (const r of results) {
      const [row] = await pool.query<{revision_no:number;summary:string}[]>("SELECT revision_no, summary FROM task_result_search WHERE task_result_id=?", [r.taskResultId]);
      expect(Number(row.revision_no)).toBe(1);
      expect(row.summary).toContain("Backfill");
    }
  });

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


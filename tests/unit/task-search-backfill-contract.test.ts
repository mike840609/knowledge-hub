import { describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { backfillTaskSearch, checkTaskSearchConsistency } from "../../scripts/db/backfill-task-search";

describe("Task Search backfill eligibility", () => {
  it("supports workspace-scoped validation for isolated test fixtures", async () => {
    const queries: { sql: string; params: unknown[] }[] = [];
    const workspaceId = "019a1e18-7a00-7000-8000-0a0000000002";
    const pool = {
      query: async (sql: string, params: unknown[] = []) => {
        queries.push({ sql, params });
        return /SELECT t\.id/i.test(sql) ? [] : [{ missing: 0, mismatched: 0 }];
      },
    } as unknown as Pool;
    expect((await checkTaskSearchConsistency(pool, workspaceId)).complete).toBe(true);
    expect(queries[0].sql).toContain("b.workspace_id = ?");
    expect(queries[0].params).toEqual([workspaceId]);
    queries.length = 0;
    expect((await backfillTaskSearch(pool, { workspaceId, batchSize: 1 })).complete).toBe(true);
    expect(queries[0].sql).toContain("b.workspace_id = ?");
    expect(queries[0].params).toEqual([workspaceId, null, null, 1]);
  });
  it("does not count uncommitted zero-revision placeholders as missing projections", async () => {
    const sql: string[] = [];
    const pool = {
      query: async (statement: string) => {
        sql.push(statement);
        return [{ missing: 0, mismatched: 0 }];
      },
    } as unknown as Pool;
    expect(await checkTaskSearchConsistency(pool)).toEqual({ missing: 0, mismatched: 0, complete: true });
    expect(sql[0]).toMatch(/WHERE\s+t\.latest_revision_no\s*>\s*0/i);
  });

  it("never selects uncommitted placeholder tasks for backfill", async () => {
    const sql: string[] = [];
    const pool = {
      query: async (statement: string) => {
        sql.push(statement);
        return /SELECT t\.id FROM task_results/i.test(statement) ? [] : [{ missing: 0, mismatched: 0 }];
      },
    } as unknown as Pool;
    const result = await backfillTaskSearch(pool, { batchSize: 1, maxBatches: 1 });
    expect(result).toMatchObject({ indexed: 0, complete: true });
    expect(sql[0]).toMatch(/t\.latest_revision_no\s*>\s*0/i);
  });
});

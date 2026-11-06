import { describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { backfillTaskSearch, checkTaskSearchConsistency } from "../../scripts/db/backfill-task-search";

describe("Task Search backfill eligibility", () => {
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

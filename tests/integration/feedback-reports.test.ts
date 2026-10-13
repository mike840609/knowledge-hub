import { beforeAll, afterAll, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { provisionIsolatedDatabase, disposeIsolatedDatabase } from "../../scripts/db/test-database";
import { runMigrations, type IsolatedDatabaseHandle } from "../../scripts/db/migrate";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createSourceFixture, fixtureCaller, fixtureIdentity } from "../fixtures/knowledge";
import { buildApplicationServices } from "@/server/composition";
let handle: IsolatedDatabaseHandle, pool: Pool, s: ReturnType<typeof buildApplicationServices>;
beforeAll(async () => {
  handle = await provisionIsolatedDatabase("test");
  pool = createDatabasePool({ ...databaseConfig("test"), database: handle.databaseName });
  await runMigrations(pool);
  await createSourceFixture(pool);
  s = buildApplicationServices(pool);
});
afterAll(async () => { await pool?.end(); if (handle) await disposeIsolatedDatabase(handle); });
it("stores a report with the reporter's emp_id", async () => {
  await s.feedbackReports.submit(fixtureCaller(), { category: "Search", description: " 搜尋不到文件 ", pagePath: "/w/x/search" });
  const rows = await pool.query("SELECT reporter_emp_id,category,page_path,description,created_at FROM feedback_reports");
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ reporter_emp_id: fixtureIdentity.emp_id, category: "Search", page_path: "/w/x/search", description: "搜尋不到文件" });
  expect(rows[0].created_at).toBeInstanceOf(Date);
});
it("refuses a reporter the Hub does not know", async () => {
  const stranger = fixtureCaller({ ...fixtureIdentity, emp_id: "NO-SUCH-EMP" });
  await expect(s.feedbackReports.submit(stranger, { category: "Other", description: "x", pagePath: "/" })).rejects.toThrow();
  expect(await pool.query("SELECT 1 FROM feedback_reports WHERE reporter_emp_id='NO-SUCH-EMP'")).toHaveLength(0);
});

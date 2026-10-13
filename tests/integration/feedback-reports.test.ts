import { afterAll, beforeAll, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { provisionIsolatedDatabase, disposeIsolatedDatabase } from "../../scripts/db/test-database";
import { runMigrations, type IsolatedDatabaseHandle } from "../../scripts/db/migrate";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { MariaDbFeedbackReportStore } from "@/infrastructure/database/mariadb/repositories/feedback-reports";
import { FeedbackReportService } from "@/modules/personal/application/feedback-report-service";
import { ensureUser, fixtureCaller, fixtureIdentity, secondFixtureIdentity } from "../fixtures/knowledge";
let handle: IsolatedDatabaseHandle, pool: Pool;
beforeAll(async () => {
  handle = await provisionIsolatedDatabase("test");
  pool = createDatabasePool({ ...databaseConfig("test"), database: handle.databaseName });
  await runMigrations(pool);
  await ensureUser(pool, fixtureIdentity);
  await ensureUser(pool, secondFixtureIdentity);
});
afterAll(async () => { await pool?.end(); if (handle) await disposeIsolatedDatabase(handle); });

it("stores the report with the sender's emp_id snapshot", async () => {
  const now = new Date("2026-10-13T08:00:00.123Z");
  const { id } = await new FeedbackReportService(new MariaDbFeedbackReportStore(pool), () => now)
    .submit(fixtureCaller(), { category: "Search", description: "No results for 請假", pagePath: "/w/abc/search" });
  const [row] = await pool.query("SELECT * FROM feedback_reports WHERE id=?", [id]);
  expect(row).toMatchObject({ user_id: fixtureIdentity.id, emp_id: fixtureIdentity.emp_id, user_name: fixtureIdentity.name, category: "Search", description: "No results for 請假", page_path: "/w/abc/search" });
  expect(new Date(row.created_at).toISOString()).toBe(now.toISOString());
});

it("caps each user at 20 reports per rolling hour without touching anyone else's", async () => {
  const now = new Date("2026-10-13T10:00:00Z");
  const service = new FeedbackReportService(new MariaDbFeedbackReportStore(pool), () => now);
  const body = { category: "Other", description: "again", pagePath: "/" };
  for (let i = 0; i < 20; i += 1) await service.submit(fixtureCaller(secondFixtureIdentity), body);
  await expect(service.submit(fixtureCaller(secondFixtureIdentity), body)).rejects.toMatchObject({ code: "FEEDBACK_RATE_LIMITED" });
  await expect(service.submit(fixtureCaller(), body)).resolves.toHaveProperty("id");
  const [{ n }] = await pool.query("SELECT COUNT(*) AS n FROM feedback_reports WHERE user_id=?", [secondFixtureIdentity.id]);
  expect(Number(n)).toBe(20);
});

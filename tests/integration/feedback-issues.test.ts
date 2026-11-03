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
const store = () => new MariaDbFeedbackReportStore(pool);
async function report(who: typeof fixtureIdentity, category: "Sync" | "Search" | "Reading" | "Other", description: string, at: Date) {
  return (await new FeedbackReportService(store(), () => at).submit(fixtureCaller(who), { category, description, pagePath: "/w/x/issues" })).id;
}

beforeAll(async () => {
  handle = await provisionIsolatedDatabase("test");
  pool = createDatabasePool({ ...databaseConfig("test"), database: handle.databaseName });
  await runMigrations(pool);
  await ensureUser(pool, fixtureIdentity);
  await ensureUser(pool, secondFixtureIdentity);
});
afterAll(async () => { await pool?.end(); if (handle) await disposeIsolatedDatabase(handle); });

it("lists every reporter newest first and defaults a new report to OPEN", async () => {
  const mine = await report(fixtureIdentity, "Sync", "mine", new Date("2026-11-02T00:00:00Z"));
  const theirs = await report(secondFixtureIdentity, "Other", "theirs", new Date("2026-11-03T00:00:00Z"));
  const rows = await store().listPage({}, 50);
  expect(rows.findIndex(r => r.id === theirs)).toBeLessThan(rows.findIndex(r => r.id === mine));
  expect(rows.find(r => r.id === theirs)).toMatchObject({
    userId: secondFixtureIdentity.id, empId: secondFixtureIdentity.emp_id,
    userName: secondFixtureIdentity.name, category: "Other", status: "OPEN", pagePath: "/w/x/issues",
  });
});

it("filters by status, category and reporter, and reads a status changed in SQL", async () => {
  const mine = await report(fixtureIdentity, "Search", "mine", new Date("2026-11-04T00:00:00Z"));
  const theirs = await report(secondFixtureIdentity, "Other", "theirs", new Date("2026-11-04T00:00:01Z"));
  await pool.query("UPDATE feedback_reports SET status='RESOLVED' WHERE id=?", [mine]);

  expect((await store().listPage({ status: "RESOLVED" }, 50)).map(r => r.id)).toContain(mine);
  expect((await store().listPage({ status: "RESOLVED" }, 50)).map(r => r.id)).not.toContain(theirs);
  expect((await store().listPage({ category: "Other" }, 50)).map(r => r.id)).not.toContain(mine);
  expect((await store().listPage({ userId: fixtureIdentity.id }, 50)).map(r => r.id)).not.toContain(theirs);
});

it("pages a composite cursor across identical timestamps without repeats or gaps", async () => {
  const at = new Date("2026-11-05T00:00:00Z");
  const ids = [];
  for (let i = 0; i < 4; i += 1) ids.push(await report(fixtureIdentity, "Reading", `page-${i}`, at));
  const expected = [...ids].reverse(); // created_at is equal, so id DESC decides
  const batch = await store().listPage({ category: "Reading" }, 3);
  const page = batch.slice(0, 2), cursor = page.at(-1)!;
  const next = (await store().listPage({ category: "Reading", before: { createdAt: cursor.createdAt, id: cursor.id } }, 3)).slice(0, 2);
  expect([...page, ...next].map(r => r.id)).toEqual(expected);
});

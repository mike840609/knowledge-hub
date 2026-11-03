# Reported Issues Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every signed-in colleague can read every "Report a problem" submission on a paged Issues page, with the reporter's name and employee ID and a status the maintainer sets in SQL.

**Architecture:** A read-only query path through the existing `personal` module: domain filter parsing, a `listPage` addition to the existing feedback store port and MariaDB adapter, a query service, and a server read projection. The page is a force-dynamic server component under the personal workspace; no API route and no write path. A migration adds a `status` enum with `OPEN` as the default.

**Tech Stack:** Next.js 15 App Router, React 19 server components, MariaDB, Vitest (unit + integration), Playwright (E2E), Tailwind design tokens (`text-body`, `rounded-md`, `kh-*`).

**Spec:** `docs/superpowers/specs/2026-11-03-feedback-issues-board-design.md`

> **Superseded in part (2026-11-03):** Tasks 4–6 built the board as a page with
> a rail row and a server read projection. Review replaced that surface with the
> dialog's Issues tab and a `GET /api/feedback-reports` list; the design document
> is the current contract. The status/query/repository work from Tasks 1–3 is
> unchanged.

## Global Constraints

- Any trusted caller may read every report; no Workspace capability or role gates the read.
- The page is personal-workspace only (`state.workspace.type === "PERSONAL"`), like `/inbox`.
- `user_id` never leaves the application boundary; the browser receives `isMine`, not `userId`.
- Status values are exactly `OPEN`, `IN_PROGRESS`, `RESOLVED`, `DUPLICATE`; DB default `OPEN`; the application never writes status.
- Page size is 50; ordering is `created_at DESC, id DESC`; the cursor is `(created_at, id)`.
- No new API route; no client fetching; the page is `export const dynamic = "force-dynamic"`.
- Every UI string is English. Use the design-language tokens; no default Tailwind size/radius/shadow/duration spellings.
- Module boundaries from `eslint.config.mjs`: `src/modules/**` imports no Next/React/MariaDB/infrastructure.
- Migration version is 28 and is appended to `migrations/index.ts`.
- Commands: `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run test:integration`.

## Review Focus

1. **A description at the 5000-character limit, with line breaks** must stay readable and collapsible rather than breaking the row — test in Task 5 (component render).
2. **Two reports sharing one `created_at` across a page boundary** must not be skipped or repeated — test in Task 2 (integration paging).
3. **A malformed cursor** (`beforeAt` not a date, `beforeId` not a UUID) must show the newest page, never a 404 — test in Task 4 (projection unit).
4. **A reporter's name or `emp_id` containing `<`, `&` or quotes** must render as text, never as markup — test in Task 5 (component render).
5. **An unknown `status`/`category` in a bookmarked URL** must show the unfiltered page — test in Task 4 (projection unit).

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/modules/personal/domain/feedback-report.ts` (modify) | Status values, page size, URL-input filter parsing |
| `src/modules/personal/ports/feedback-report-store.ts` (modify) | Add `listPage` and the record/filter types |
| `src/infrastructure/database/mariadb/repositories/feedback-reports.ts` (modify) | The one `SELECT` and row mapping |
| `src/modules/personal/application/feedback-report-query-service.ts` (create) | Caller-scoped listing, `isMine`, next cursor |
| `src/server/composition.ts` (modify) | One store shared by submit and query services |
| `src/server/feedback-issues-read.ts` (create) | Normalise URL input, authorize the personal workspace, map failure to `null` |
| `src/components/knowledge/feedback-issues.tsx` (create) | Presentational list, status words, disclosure, empty states |
| `src/app/w/[workspaceId]/issues/page.tsx` (create) | Header, filter form, list, Older link |
| `src/components/shell/primary-nav.tsx` (modify) | Personal-only Issues row |
| `src/infrastructure/database/mariadb/migrations/031-feedback-status.ts` (create) | Status column and index |
| `src/infrastructure/database/mariadb/migrations/index.ts` (modify) | Register migration 28 |
| `docs/superpowers/specs/2026-10-13-feedback-reports-to-database-design.md` (modify) | Amend the append-only and "no screen" sentences |

---

### Task 1: Status values and filter parsing

**Files:**
- Modify: `src/modules/personal/domain/feedback-report.ts`
- Test: `tests/unit/feedback-issue-filter.test.ts` (create)

**Interfaces:**
- Produces:
  - `FEEDBACK_STATUSES: readonly ["OPEN", "IN_PROGRESS", "RESOLVED", "DUPLICATE"]`
  - `type FeedbackStatus = "OPEN" | "IN_PROGRESS" | "RESOLVED" | "DUPLICATE"`
  - `FEEDBACK_ISSUE_PAGE_SIZE = 50`
  - `type FeedbackIssueFilter = { status?: FeedbackStatus; category?: FeedbackCategory; mineOnly: boolean; before?: { createdAt: Date; id: string } }`
  - `parseFeedbackIssueFilter(input: { status?: unknown; category?: unknown; mine?: unknown; beforeAt?: unknown; beforeId?: unknown }): FeedbackIssueFilter`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/feedback-issue-filter.test.ts
import { describe, expect, it } from "vitest";
import { parseFeedbackIssueFilter } from "@/modules/personal/domain/feedback-report";

const cursorId = "0199f400-0000-7000-8000-000000000001";

describe("parseFeedbackIssueFilter", () => {
  it("defaults to everyone, every status, newest page", () => {
    expect(parseFeedbackIssueFilter({})).toEqual({ mineOnly: false });
    expect(parseFeedbackIssueFilter({ status: "", category: "", mine: "" })).toEqual({ mineOnly: false });
  });

  it("reads the filters and a composite cursor", () => {
    expect(parseFeedbackIssueFilter({
      status: "RESOLVED", category: "Search", mine: "true",
      beforeAt: "2026-11-03T01:02:03.000Z", beforeId: cursorId,
    })).toEqual({
      status: "RESOLVED", category: "Search", mineOnly: true,
      before: { createdAt: new Date("2026-11-03T01:02:03.000Z"), id: cursorId },
    });
  });

  it.each([
    ["an unknown status", { status: "CLOSED" }],
    ["an unknown category", { category: "Billing" }],
    ["a cursor without its id", { beforeAt: "2026-11-03T01:02:03.000Z" }],
    ["a cursor without its time", { beforeId: cursorId }],
    ["a cursor time that is not a date", { beforeAt: "yesterday", beforeId: cursorId }],
    ["a cursor id that is not a UUID", { beforeAt: "2026-11-03T01:02:03.000Z", beforeId: "1" }],
  ])("rejects %s", (_name, input) => {
    expect(() => parseFeedbackIssueFilter(input)).toThrow(expect.objectContaining({ code: "INVALID_REQUEST" }));
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run --config vitest.config.ts tests/unit/feedback-issue-filter.test.ts`
Expected: FAIL — `parseFeedbackIssueFilter` is not exported.

- [ ] **Step 3: Implement the statuses, page size and parser**

Add to `src/modules/personal/domain/feedback-report.ts` (keep existing exports and `DomainError`):

```ts
export const FEEDBACK_STATUSES = ["OPEN", "IN_PROGRESS", "RESOLVED", "DUPLICATE"] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];
export const FEEDBACK_ISSUE_PAGE_SIZE = 50;

export type FeedbackIssueFilter = {
  status?: FeedbackStatus;
  category?: FeedbackCategory;
  mineOnly: boolean;
  before?: { createdAt: Date; id: string };
};
```

`parseFeedbackIssueFilter` rules, all throwing `DomainError("INVALID_REQUEST", …)`:
- an absent, `undefined` or `""` `status`/`category` is absent; a non-empty value must be a member of `FEEDBACK_STATUSES` / `FEEDBACK_CATEGORIES`;
- `mineOnly` is `mine === true || mine === "true"`, anything else is `false`;
- `beforeAt` and `beforeId` are either both present and non-empty, or both absent;
- `beforeAt` must parse to a valid `Date`, `beforeId` must satisfy `isUuid` from `@/shared/ids/uuidv7`.
Import `isUuid` at the top of the file.

- [ ] **Step 4: Run the tests and see them pass**

Run: `npx vitest run --config vitest.config.ts tests/unit/feedback-issue-filter.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/personal/domain/feedback-report.ts tests/unit/feedback-issue-filter.test.ts
git commit -m "feat(issues): parse the report list filters and statuses"
```

---

### Task 2: Migration and the repository's one list query

**Files:**
- Create: `src/infrastructure/database/mariadb/migrations/031-feedback-status.ts`
- Modify: `src/infrastructure/database/mariadb/migrations/index.ts`
- Modify: `src/modules/personal/ports/feedback-report-store.ts`
- Modify: `src/infrastructure/database/mariadb/repositories/feedback-reports.ts`
- Modify: `tests/unit/feedback-report-service.test.ts` (the `MemoryStore` must implement the new method)
- Test: `tests/integration/feedback-issues.test.ts` (create)

**Interfaces:**
- Consumes: `FeedbackStatus` from Task 1.
- Produces:
  - `type FeedbackIssueRecord = { id: string; userId: string; empId: string; userName: string; category: FeedbackCategory; description: string; pagePath: string; status: FeedbackStatus; createdAt: Date }`
  - `type FeedbackIssueStoreFilter = { status?: FeedbackStatus; category?: FeedbackCategory; userId?: string; before?: { createdAt: Date; id: string } }`
  - `FeedbackReportStore.listPage(filter: FeedbackIssueStoreFilter, limit: number): Promise<FeedbackIssueRecord[]>`

- [ ] **Step 1: Write the failing integration test**

```ts
// tests/integration/feedback-issues.test.ts
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
```

In `tests/unit/feedback-report-service.test.ts`, add the new method to `MemoryStore` so it still implements the port:

```ts
async listPage() { return []; }
```

- [ ] **Step 2: Run it and watch it fail**

Run: `make db-up` once, then `npx vitest run --config vitest.integration.config.ts tests/integration/feedback-issues.test.ts`
Expected: FAIL — the migration version 28 is unknown and `listPage` does not exist.

- [ ] **Step 3: Add the migration and implement `listPage`**

Create `031-feedback-status.ts` with `version: 31, name: "feedback-status"` and the statements from the spec (`ADD COLUMN status ENUM(...) NOT NULL DEFAULT 'OPEN' AFTER page_path`, `ADD KEY idx_feedback_status_created (status, created_at, id)`); register it after `namedShareRecipientsMigration`.

Add the port types above to `feedback-report-store.ts` and this method to `MariaDbFeedbackReportStore`:

```ts
async listPage(filter: FeedbackIssueStoreFilter, limit: number): Promise<FeedbackIssueRecord[]> {
  const where: string[] = [], params: unknown[] = [];
  if (filter.status) { where.push("status = ?"); params.push(filter.status); }
  if (filter.category) { where.push("category = ?"); params.push(filter.category); }
  if (filter.userId) { where.push("user_id = ?"); params.push(filter.userId); }
  if (filter.before) { where.push("(created_at, id) < (?, ?)"); params.push(filter.before.createdAt, filter.before.id); }
  const rows = await this.pool.query(
    `SELECT id, user_id, emp_id, user_name, category, description, page_path, status, created_at
       FROM feedback_reports${where.length ? ` WHERE ${where.join(" AND ")}` : ""}
      ORDER BY created_at DESC, id DESC LIMIT ?`, [...params, limit]);
  return rows.map(mapIssue);
}
```

`mapIssue` uses `asDate`/`asRequiredString` from `./shared`; validate `category` and `status` against the domain arrays and throw `IntegrityViolationError` otherwise.

- [ ] **Step 4: Run it and see it pass**

Run: `npx vitest run --config vitest.integration.config.ts tests/integration/feedback-issues.test.ts`
Expected: PASS (3 tests). Then `npm run test:unit` — the existing feedback-service test still passes.

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/database/mariadb/migrations/031-feedback-status.ts src/infrastructure/database/mariadb/migrations/index.ts src/modules/personal/ports/feedback-report-store.ts src/infrastructure/database/mariadb/repositories/feedback-reports.ts tests/integration/feedback-issues.test.ts tests/unit/feedback-report-service.test.ts
git commit -m "feat(issues): read reports through one paged status-aware query"
```

---

### Task 3: The query service and composition

**Files:**
- Create: `src/modules/personal/application/feedback-report-query-service.ts`
- Modify: `src/server/composition.ts:87` and the returned service object
- Test: `tests/unit/feedback-issue-query-service.test.ts` (create)

**Interfaces:**
- Consumes: `FeedbackReportStore.listPage`, `FeedbackIssueRecord`, `FeedbackIssueStoreFilter` (Task 2); `parseFeedbackIssueFilter`, `FEEDBACK_ISSUE_PAGE_SIZE` (Task 1).
- Produces:
  - `type FeedbackIssueView = { id: string; empId: string; userName: string; category: FeedbackCategory; description: string; pagePath: string; status: FeedbackStatus; createdAt: string; isMine: boolean }`
  - `type FeedbackIssuePage = { items: FeedbackIssueView[]; nextCursor: { createdAt: string; id: string } | null }`
  - `class FeedbackReportQueryService { constructor(store: FeedbackReportStore); list(caller: CallerContext, input: Parameters<typeof parseFeedbackIssueFilter>[0]): Promise<FeedbackIssuePage> }`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/feedback-issue-query-service.test.ts
import { describe, expect, it } from "vitest";
import { FeedbackReportQueryService } from "@/modules/personal/application/feedback-report-query-service";
import type { FeedbackIssueRecord, FeedbackIssueStoreFilter, FeedbackReportStore } from "@/modules/personal/ports/feedback-report-store";
import { fixtureCaller, fixtureIdentity } from "../fixtures/knowledge";

function record(n: number, userId = fixtureIdentity.id): FeedbackIssueRecord {
  return {
    id: `0199f400-0000-7000-8000-${String(n).padStart(12, "0")}`, userId, empId: userId === fixtureIdentity.id ? fixtureIdentity.emp_id : "OTHER",
    userName: "Reporter", category: "Sync", description: `report ${n}`, pagePath: "/w/x/issues",
    status: "OPEN", createdAt: new Date(2026, 10, 3, 0, 0, n),
  };
}
class FakeStore implements FeedbackReportStore {
  calls: Array<{ filter: FeedbackIssueStoreFilter; limit: number }> = [];
  constructor(private readonly rows: FeedbackIssueRecord[]) {}
  async appendWithinLimit() { return null; }
  async listPage(filter: FeedbackIssueStoreFilter, limit: number) { this.calls.push({ filter, limit }); return this.rows.slice(0, limit); }
}

describe("FeedbackReportQueryService.list", () => {
  it("asks for one row beyond the page and returns the last shown row as the cursor", async () => {
    const store = new FakeStore(Array.from({ length: 51 }, (_, i) => record(i + 1)));
    const page = await new FeedbackReportQueryService(store).list(fixtureCaller(), {});
    expect(store.calls[0].limit).toBe(51);
    expect(page.items).toHaveLength(50);
    expect(page.nextCursor).toEqual({ createdAt: page.items[49].createdAt, id: page.items[49].id });
  });

  it("returns no cursor when the page is not full", async () => {
    const page = await new FeedbackReportQueryService(new FakeStore([record(1)])).list(fixtureCaller(), {});
    expect(page.nextCursor).toBeNull();
  });

  it("filters by the trusted caller only when mine is asked for, and never sends userId onward", async () => {
    const store = new FakeStore([record(1), record(2, "0199f400-0000-7000-8000-000000000999")]);
    const page = await new FeedbackReportQueryService(store).list(fixtureCaller(), { mine: "true" });
    expect(store.calls[0].filter.userId).toBe(fixtureIdentity.id);
    expect(page.items.map(i => i.isMine)).toEqual([true, false]);
    expect(page.items[0]).not.toHaveProperty("userId");
  });

  it("rejects a malformed filter before reading", async () => {
    const store = new FakeStore([]);
    await expect(new FeedbackReportQueryService(store).list(fixtureCaller(), { status: "CLOSED" }))
      .rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(store.calls).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run --config vitest.config.ts tests/unit/feedback-issue-query-service.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement the service and wire it**

`list` parses via `parseFeedbackIssueFilter`, maps `mineOnly` to `userId: caller.identity.id`, calls `store.listPage(filter, FEEDBACK_ISSUE_PAGE_SIZE + 1)`, slices to 50, maps rows to `FeedbackIssueView` (ISO `createdAt`, `isMine: row.userId === caller.identity.id`, no `userId`) and computes `nextCursor` from the 50th row when a 51st arrived.

In `composition.ts`, create one store and share it:

```ts
const feedbackReportStore = new MariaDbFeedbackReportStore(databasePool);
const feedbackReports = new FeedbackReportService(feedbackReportStore);
const feedbackIssues = new FeedbackReportQueryService(feedbackReportStore);
```

Add `feedbackIssues` to the returned object beside `feedbackReports`.

- [ ] **Step 4: Run the tests and see them pass**

Run: `npx vitest run --config vitest.config.ts tests/unit/feedback-issue-query-service.test.ts` and `npm run typecheck`
Expected: PASS and no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/modules/personal/application/feedback-report-query-service.ts src/server/composition.ts tests/unit/feedback-issue-query-service.test.ts
git commit -m "feat(issues): serve one page of reports for the signed-in caller"
```

---

### Task 4: The server read projection

**Files:**
- Create: `src/server/feedback-issues-read.ts`
- Test: `tests/unit/feedback-issues-read.test.ts` (create)

**Interfaces:**
- Consumes: `FeedbackReportQueryService.list` (Task 3); `applicationServices().feedbackIssues`, `.workspaceAdmin.workspaceState`, `.establishTrustedCaller` (Task 3).
- Produces:
  - `type FeedbackIssuesModel = { page: FeedbackIssuePage; filters: { status?: FeedbackStatus; category?: FeedbackCategory; mineOnly: boolean } }`
  - `getFeedbackIssues(workspaceId: string, query: Record<string, string | string[] | undefined>): Promise<FeedbackIssuesModel | null>`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/feedback-issues-read.test.ts
import { describe, expect, it, vi } from "vitest";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import { WorkspaceNotFoundError } from "@/modules/workspaces/domain/errors";
import type { applicationServices as ApplicationServicesFn } from "@/server/composition";

vi.mock("@/server/composition", () => ({ applicationServices: vi.fn() }));
import { applicationServices } from "@/server/composition";
import { getFeedbackIssues } from "@/server/feedback-issues-read";

type Services = ReturnType<typeof ApplicationServicesFn>;
const WORKSPACE_ID = "0199f400-0000-7000-8000-0000000004b1";
const caller = callerFromIdentity({ id: "0199f400-0000-7000-8000-0000000004b2", emp_id: "P4-READ", name: "Reader", org_code: "HRSD" });
const personal = { id: WORKSPACE_ID, name: "My Space", type: "PERSONAL" as const, lifecycleState: "ACTIVE" as const };
const emptyPage = { items: [], nextCursor: null };

function fakeServices(overrides: { type?: "PERSONAL" | "TEAM"; workspaceState?: () => Promise<unknown>; list?: ReturnType<typeof vi.fn> } = {}): Services {
  return {
    establishTrustedCaller: vi.fn(async () => ({ caller })),
    workspaceAdmin: { workspaceState: overrides.workspaceState ?? vi.fn(async () => ({ workspace: { ...personal, type: overrides.type ?? "PERSONAL" }, effectiveCapabilities: [], actions: {} })) },
    feedbackIssues: { list: overrides.list ?? vi.fn(async () => emptyPage) },
  } as unknown as Services;
}

describe("getFeedbackIssues", () => {
  it("drops values the page does not recognise and still renders the newest page", async () => {
    vi.mocked(applicationServices).mockReturnValue(fakeServices());
    const model = await getFeedbackIssues(WORKSPACE_ID, { status: "CLOSED", category: "Billing", beforeAt: "yesterday", beforeId: "1" });
    expect(model?.filters).toEqual({ status: undefined, category: undefined, mineOnly: false });
    expect(applicationServices().feedbackIssues.list).toHaveBeenCalledWith(caller, { status: undefined, category: undefined, mine: undefined, beforeAt: undefined, beforeId: undefined });
  });

  it("passes a recognised filter and cursor through", async () => {
    vi.mocked(applicationServices).mockReturnValue(fakeServices());
    const model = await getFeedbackIssues(WORKSPACE_ID, { status: "RESOLVED", category: "Search", mine: "true", beforeAt: "2026-11-03T01:02:03.000Z", beforeId: "0199f400-0000-7000-8000-000000000001" });
    expect(model?.filters).toEqual({ status: "RESOLVED", category: "Search", mineOnly: true });
  });

  it("returns null outside a personal workspace and when access is denied", async () => {
    vi.mocked(applicationServices).mockReturnValue(fakeServices({ type: "TEAM" }));
    await expect(getFeedbackIssues(WORKSPACE_ID, {})).resolves.toBeNull();
    vi.mocked(applicationServices).mockReturnValue(fakeServices({ workspaceState: vi.fn(async () => { throw new WorkspaceNotFoundError(); }) }));
    await expect(getFeedbackIssues(WORKSPACE_ID, {})).resolves.toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run --config vitest.config.ts tests/unit/feedback-issues-read.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement the projection**

Normalise each `searchParams` value with `firstSearchParam` from `@/lib/search-params`; keep only members of `FEEDBACK_STATUSES`/`FEEDBACK_CATEGORIES`; keep a cursor only when both halves are non-empty, `Date.parse` succeeds and `isUuid` accepts the id. Run the normalised input through `parseFeedbackIssueFilter` to produce the model's `filters` (it cannot throw now). Then `establishTrustedCaller`, `workspaceState`, return `null` when the type is not `PERSONAL` or when `workspaceState` throws `DomainError` with `WORKSPACE_NOT_FOUND`/`WORKSPACE_ACCESS_DENIED`/`INSUFFICIENT_WORKSPACE_CAPABILITY`. Call `services.feedbackIssues.list(caller, normalised)` and return `{ page, filters }`.

- [ ] **Step 4: Run the tests and see them pass**

Run: `npx vitest run --config vitest.config.ts tests/unit/feedback-issues-read.test.ts` and `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/feedback-issues-read.ts tests/unit/feedback-issues-read.test.ts
git commit -m "feat(issues): authorize the personal page and normalise its filters"
```

---

### Task 5: The list, the page and the rail row

**Files:**
- Create: `src/components/knowledge/feedback-issues.tsx`
- Create: `src/app/w/[workspaceId]/issues/page.tsx`
- Modify: `src/components/shell/primary-nav.tsx` (import and one item)
- Test: `tests/unit/feedback-issues.test.tsx` (create)

**Interfaces:**
- Consumes: `FeedbackIssuesModel` (Task 4), `getFeedbackIssues` (Task 4), `FeedbackIssuePage`/`FeedbackIssueView` (Task 3).
- Produces: `FeedbackIssues({ page, filtered }: { page: FeedbackIssuePage; filtered: boolean })`.

- [ ] **Step 1: Write the failing component test**

```tsx
// tests/unit/feedback-issues.test.tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FeedbackIssues } from "@/components/knowledge/feedback-issues";
import type { FeedbackIssuePage, FeedbackIssueView } from "@/modules/personal/application/feedback-report-query-service";

function view(overrides: Partial<FeedbackIssueView> = {}): FeedbackIssueView {
  return {
    id: "0199f400-0000-7000-8000-000000000001", empId: "E2E-0909", userName: "E2E Knowledge User",
    category: "Sync", description: "Preview failed", pagePath: "/w/x/sources",
    status: "OPEN", createdAt: "2026-11-03T00:00:00.000Z", isMine: true, ...overrides,
  };
}
function render(items: FeedbackIssueView[], filtered = false): string {
  const page: FeedbackIssuePage = { items, nextCursor: null };
  return renderToStaticMarkup(<FeedbackIssues page={page} filtered={filtered} />);
}

describe("FeedbackIssues", () => {
  it("shows status, category, reporter, employee id, path and the reader's own marker", () => {
    const html = render([view()]);
    expect(html).toContain("Open");
    expect(html).toContain("Sync");
    expect(html).toContain("E2E Knowledge User");
    expect(html).toContain("E2E-0909");
    expect(html).toContain("/w/x/sources");
    expect(html).toContain("You");
  });

  it("collapses a long, multi-line description behind a disclosure", () => {
    const long = render([view({ description: `${"step one\nstep two\n".repeat(60)}`.slice(0, 5000) })]);
    expect(long).toContain("<details");
    expect(long).toContain("Show the full report");
    expect(render([view()])).not.toContain("<details");
  });

  it("renders a hostile reporter name as text", () => {
    const html = render([view({ userName: "<script>alert(1)</script>", empId: "<b>X</b>" })]);
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;b&gt;");
  });

  it("says when there is nothing to show, filtered or not", () => {
    expect(render([], false)).toContain("No reports yet");
    expect(render([], true)).toContain("No reports match these filters");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run --config vitest.config.ts tests/unit/feedback-issues.test.tsx`
Expected: FAIL — the component does not exist.

- [ ] **Step 3: Implement the component, the page and the rail row**

Component: `Status` for the word (mapping `OPEN`→`active` "Open", `IN_PROGRESS`→`pending` "In progress", `RESOLVED`→`success` "Resolved", `DUPLICATE`→`none` "Duplicate"), `Badge` for the category, name + `emp_id` + muted "You", `Timestamp value={item.createdAt}`, the path in `font-mono`, `whitespace-pre-wrap` for the short description, and a `<details><summary>Show the full report</summary>` block when `description.length > 280`. Wrap rows in `<ol aria-label="Reported issues">` with stable `key={item.id}`. Empty states: one muted sentence, no heading.

Page: force-dynamic, `PageHeader` (`location="My Space"`, `locationHref={`/w/${workspaceId}`}`, `title="Issues"`), one muted header sentence, a `<form action={/w/${workspaceId}/issues}>` with `Select name="status"` (All statuses + the four), `Select name="category"` (All categories + the four), a `Mine only` checkbox, `LiveSearch` and the `noscript` submit; render `<FeedbackIssues page={model.page} filtered={Boolean(status || category || mineOnly)} />`; below it, an `Older issues` `Link` built with `URLSearchParams` from the applied filters plus `beforeAt`/`beforeId` when `nextCursor` exists. Do not carry `beforeAt`/`beforeId` in the filter form.

Nav: import `MessageSquareWarning` and add, after the `Home` row:

```ts
...(personal ? [{ name: "Issues", href: `/w/${workspaceId}/issues`, Icon: MessageSquareWarning }] : []),
```

- [ ] **Step 4: Run the tests and see them pass**

Run: `npx vitest run --config vitest.config.ts tests/unit/feedback-issues.test.tsx`, `npm run typecheck`, `npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/knowledge/feedback-issues.tsx src/app/w/\[workspaceId\]/issues/page.tsx src/components/shell/primary-nav.tsx tests/unit/feedback-issues.test.tsx
git commit -m "feat(issues): show every reported problem in My Space"
```

---

### Task 6: Browser verification and the amended earlier spec

**Files:**
- Test: `tests/e2e/feedback-issues.spec.ts` (create)
- Modify: `docs/superpowers/specs/2026-10-13-feedback-reports-to-database-design.md`

**Interfaces:**
- Consumes: the page from Task 5; `feedback_reports` and migration 28 from Task 2.

- [ ] **Step 1: Write the E2E spec**

Cover, in this order, using `page.goto("/")` and the personal workspace id from `/api/workspaces`. Ids for seeded rows come from `crypto.randomUUID()`.
1. the personal rail has an `Issues` link and it opens the page;
2. send two reports through the account menu dialog (categories `Sync` and `Other`, descriptions `Issues board first` and `Issues board second`) and see both listed, `Open`, with the local identity's name and `E2E-0909`;
3. seed a second reporter and one report directly with `createDatabasePool(databaseConfig("e2e"))`:

```sql
INSERT INTO users (id, emp_id, name, org_code) VALUES (?, 'E2E-OTHER', 'Other Reporter', 'E2E')
INSERT INTO feedback_reports (id,user_id,emp_id,user_name,category,description,page_path,created_at)
VALUES (?,?,'E2E-OTHER','Other Reporter','Other','Other reporter issue','/w/x/knowledge',UTC_TIMESTAMP(6))
```

reload and see `Other Reporter` and `E2E-OTHER` beside the reader's own rows;
4. `UPDATE feedback_reports SET status='RESOLVED' WHERE id=?` for the seeded row, reload, and see `Resolved`; `?status=RESOLVED` shows it and hides the open ones; `?category=Sync` shows only the first report; `?mine=true` hides the other reporter;
5. `?status=CLOSED` still renders the list (no 404) with `All statuses` selected;
6. assert there is no control whose name suggests changing a status;
7. seed 55 `Reading` reports for the second reporter with `created_at` stepping back one second each (`DATE_SUB(UTC_TIMESTAMP(6), INTERVAL ? SECOND)`), apply `?category=Reading`, assert the `Reported issues` list has 50 rows and an `Older issues` link, click it, and assert every row is `Reading` and the first page's ids do not repeat.

Close the pool in a `finally`.

- [ ] **Step 2: Run the spec**

Run: `npx tsx scripts/test/e2e.ts tests/e2e/feedback-issues.spec.ts`
Expected: PASS. If it fails, fix the page or the fixture, not an assertion that reads the spec correctly; the script builds the app first.

- [ ] **Step 3: Amend the earlier spec**

In `docs/superpowers/specs/2026-10-13-feedback-reports-to-database-design.md`, replace "Reports are append-only: no update or delete path exists." with a sentence saying the application still has no update/delete path, while `status` may be changed outside it — see the 2026-11-03 issues-board design. Replace the "Not in this change" screen sentence with a pointer to the new spec. Leave the rest as the historical record.

- [ ] **Step 4: Run the whole gate**

Run: `make verify` (unit + typecheck + lint + build)
Expected: PASS. Then report the E2E command and its result.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/feedback-issues.spec.ts docs/superpowers/specs/2026-10-13-feedback-reports-to-database-design.md
git commit -m "test(issues): verify the board in a browser and amend the earlier spec"
```

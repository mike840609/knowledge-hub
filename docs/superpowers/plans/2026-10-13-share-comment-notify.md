# Share-Comment Notify Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a signed-in holder comments on a shared page (`/s/:token`), the document's PERSONAL workspace owner gets an in-app unread notice; opening the owner review panel clears it.

**Architecture:** New `share_comment_events` table plus a repository port/adapter; `DocumentReviewService.create()`/`reply()` insert one event in the same unit of work when and only when `originShareLinkId` is not null; new owner-scoped read/mark-read service methods behind `reviewHttp`; badge UI in the owner panel.

**Tech Stack:** TypeScript, MariaDB 10.11, Vitest (unit + integration), Playwright (e2e), Next.js 15 App Router routes.

**Spec:** `docs/superpowers/specs/2026-10-13-share-comment-notify-design.md`

## Global Constraints

- `src/modules/**` may not import `next`, `react`, `mariadb`, or anything under `src/infrastructure/` (enforced by `no-restricted-imports`; `make lint` fails on violation).
- `src/components/**` and `src/app/**` may not import `src/infrastructure/` or `mariadb`; web adapters call application services through the composition root.
- Knowing an ID is not authorization: the unread/mark-read APIs take no user id parameter; the recipient is always `caller.identity.id`, re-verified per request.
- Exactly two entries answer without a caller (`readShared`, `queryForLink`); this feature adds no anonymous entry. All writes require a trusted caller plus live token.
- Event insert failure rolls back the whole comment transaction; mark-read failure never blocks reading.
- Migrations are additive and forward-only; next version is 22.

---

## File Structure

- Create: `src/modules/knowledge/domain/share-comment-event.ts` — `ShareCommentEvent` type plus the `projectShareCommentNotification` pure projection (80-char excerpt).
- Create: `src/modules/knowledge/ports/share-comment-event-repository.ts` — `ShareCommentEventRepository` port (`insert`, `listUnreadByRecipient`, `markDocumentRead`).
- Modify: `src/modules/knowledge/ports/unit-of-work.ts` — add `shareCommentEvents: ShareCommentEventRepository` to `KnowledgeRepositories`.
- Create: `src/infrastructure/database/mariadb/migrations/022-share-comment-events.ts` — version 22 DDL; register in `src/infrastructure/database/mariadb/migrations/index.ts`.
- Create: `src/infrastructure/database/mariadb/repositories/share-comment-events.ts` — MariaDB adapter; wire one line in `src/infrastructure/database/mariadb/repositories/index.ts`.
- Modify: `src/modules/knowledge/application/document-review-service.ts` — emit in `create()` and `reply()` for link-origin writes only; add `listUnreadForOwner` + `markDocumentRead`.
- Create: `src/app/api/review-notifications/unread/route.ts` and `src/app/api/review-notifications/mark-read/route.ts` — thin `reviewHttp` wrappers.
- Create: `src/components/knowledge/share-comment-notifications.ts` — `useShareCommentUnread` hook (fetch unread, mark-read on panel open).
- Modify: `src/components/knowledge/owner-review-panel.tsx` — badge count in the panel header; call mark-read after threads load.
- Test: `tests/unit/share-comment-event.test.ts` (projection/excerpt pure logic).
- Test: `tests/integration/share-comment-notify.test.ts` (DB-backed, mirrors `tests/integration/document-review-service.test.ts` fixture).
- Test: `tests/e2e/share-comment-notify.spec.ts` (holder comments on `/s/:token` → owner sees dot).

---

### Task 1: Domain type, port, and UoW slot

**Files:**
- Create: `src/modules/knowledge/domain/share-comment-event.ts`
- Create: `src/modules/knowledge/ports/share-comment-event-repository.ts`
- Modify: `src/modules/knowledge/ports/unit-of-work.ts`
- Test: `tests/unit/share-comment-event.test.ts`

**Interfaces:**
- Consumes: `ReviewThread`/`ReviewComment` ids (strings) from `../domain/document-review` (types only).
- Produces: `ShareCommentEvent`, `ShareCommentNotificationView`, `ShareCommentEventRepository` — exact names later tasks import.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { projectShareCommentNotification } from "@/modules/knowledge/domain/share-comment-event";
describe("projectShareCommentNotification", () => {
  it("truncates the body excerpt to 80 characters", () => {
    const view = projectShareCommentNotification({
      id: "e1", workspaceId: "w1", documentId: "d1", documentTitle: "Doc",
      threadId: "t1", commentId: "c1", authorName: "Reviewer",
      body: "x".repeat(200), createdAt: new Date("2026-10-13T00:00:00Z"),
    });
    expect(view.excerpt).toBe("x".repeat(80));
    expect(view.excerpt.length).toBe(80);
  });
  it("keeps short bodies intact", () => {
    const view = projectShareCommentNotification({
      id: "e1", workspaceId: "w1", documentId: "d1", documentTitle: "Doc",
      threadId: "t1", commentId: "c1", authorName: "Reviewer",
      body: "hello", createdAt: new Date("2026-10-13T00:00:00Z"),
    });
    expect(view.excerpt).toBe("hello");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.config.ts tests/unit/share-comment-event.test.ts`
Expected: FAIL with "Failed to resolve import ... share-comment-event"

- [ ] **Step 3: Write minimal implementation**

`src/modules/knowledge/domain/share-comment-event.ts`:
```ts
export type ShareCommentEvent = {
  id: string; workspaceId: string; documentId: string;
  threadId: string; commentId: string; originShareLinkId: string;
  createdByUserId: string; mentionedUserId: string | null;
  createdAt: Date; readAt: Date | null;
};
export type ShareCommentNotificationView = {
  id: string; workspaceId: string; documentId: string; documentTitle: string;
  threadId: string; commentId: string; authorName: string | undefined;
  excerpt: string; createdAt: Date;
};
const EXCERPT_LIMIT = 80;
export function projectShareCommentNotification(input: {
  id: string; workspaceId: string; documentId: string; documentTitle: string;
  threadId: string; commentId: string; authorName: string | undefined;
  body: string; createdAt: Date;
}): ShareCommentNotificationView {
  const { body, ...rest } = input;
  return { ...rest, excerpt: [...body].slice(0, EXCERPT_LIMIT).join("") };
}
```

`src/modules/knowledge/ports/share-comment-event-repository.ts`:
```ts
import type { ShareCommentEvent } from "../domain/share-comment-event";
export interface ShareCommentEventRepository {
  insert(event: ShareCommentEvent): Promise<void>;
  listUnreadByRecipient(recipientUserId: string): Promise<ShareCommentEvent[]>;
  markDocumentRead(recipientUserId: string, documentId: string, at: Date): Promise<void>;
}
```

In `src/modules/knowledge/ports/unit-of-work.ts`, add the import and the slot:
```ts
import type { ShareCommentEventRepository } from "./share-comment-event-repository";
export type KnowledgeRepositories = {
  reviewThreads: DocumentReviewThreadRepository;
  reviewComments: DocumentReviewCommentRepository;
  reviewWriteLedger: DocumentReviewWriteLedger;
  shareCommentEvents: ShareCommentEventRepository;
  // ... rest unchanged
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.config.ts tests/unit/share-comment-event.test.ts`
Expected: PASS (2 passed)

- [ ] **Step 5: Typecheck the touched files**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit 0. (Full-repo typecheck; if pre-existing errors appear elsewhere, confirm none point at the four touched files.)

---

### Task 2: Migration 022 and registration

**Files:**
- Create: `src/infrastructure/database/mariadb/migrations/022-share-comment-events.ts`
- Modify: `src/infrastructure/database/mariadb/migrations/index.ts`
- Test: `tests/integration/share-comment-notify.test.ts` (migration exercised implicitly; schema asserted in Task 4 Step 1)

**Interfaces:**
- Consumes: `Migration` type from `./types`; table names `knowledge_documents`, `document_review_threads`, `document_review_comments`, `document_share_links`, `users`, `workspaces` (all exist at version 21).
- Produces: `shareCommentEventsMigration` (version 22) applied by the runner in order.

- [ ] **Step 1: Write the migration file**

```ts
import type { Migration } from "./types";
// Additive: one row per link-origin comment for the document owner's inbox.
// mentioned_user_id stays NULL in this cut; a later @-mention cut fills it.
export const shareCommentEventsMigration: Migration = {
  version: 22, name: "share-comment-events", statements: [
`CREATE TABLE share_comment_events (
 id UUID NOT NULL PRIMARY KEY, workspace_id UUID NOT NULL, document_id UUID NOT NULL,
 thread_id UUID NOT NULL, comment_id UUID NOT NULL, origin_share_link_id UUID NOT NULL,
 created_by_user_id UUID NOT NULL, mentioned_user_id UUID NULL,
 created_at DATETIME(6) NOT NULL, read_at DATETIME(6) NULL,
 UNIQUE KEY uq_share_comment_event (comment_id),
 KEY ix_share_comment_inbox (workspace_id,read_at,created_at),
 KEY ix_share_comment_document (document_id,read_at),
 FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT,
 FOREIGN KEY (document_id) REFERENCES knowledge_documents(id) ON DELETE RESTRICT,
 FOREIGN KEY (thread_id) REFERENCES document_review_threads(id) ON DELETE RESTRICT,
 FOREIGN KEY (comment_id) REFERENCES document_review_comments(id) ON DELETE RESTRICT,
 FOREIGN KEY (origin_share_link_id) REFERENCES document_share_links(id) ON DELETE RESTRICT,
 FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
 FOREIGN KEY (mentioned_user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  ],
};
```

Register in `src/infrastructure/database/mariadb/migrations/index.ts`: add the import at the top and `shareCommentEventsMigration` at the end of the `migrations` array.

- [ ] **Step 2: Run the migration against the dev database**

Run: `make db-up && npm run db:migrate`
Expected: exit 0; `share_comment_events` exists. Verify with `npm run db:migrate` output showing version 22 applied (the migrate script logs each applied version).

- [ ] **Step 3: Run the integration suite to prove nothing regressed**

Run: `make test-integration` (provisions an isolated DB, migrates including version 22, runs the full integration suite).
Expected: PASS.

---

### Task 3: MariaDB adapter and repository wiring

**Files:**
- Create: `src/infrastructure/database/mariadb/repositories/share-comment-events.ts`
- Modify: `src/infrastructure/database/mariadb/repositories/index.ts`
- Test: `tests/integration/share-comment-notify.test.ts` (adapter exercised via service in Task 4)

**Interfaces:**
- Consumes: `ShareCommentEvent`, `ShareCommentEventRepository` (Task 1); `DbRow`, `QueryConnection`, `asDate`/`asNullableDate` from `./shared`.
- Produces: `MariaDbShareCommentEventsRepository` wired as `shareCommentEvents` in `createRepositories`.

- [ ] **Step 1: Write the adapter**

```ts
import { asDate, asNullableDate, type DbRow, type QueryConnection } from "./shared";
import type { ShareCommentEvent } from "@/modules/knowledge/domain/share-comment-event";
import type { ShareCommentEventRepository } from "@/modules/knowledge/ports/share-comment-event-repository";
function map(row: DbRow): ShareCommentEvent {
  return {
    id: String(row.id), workspaceId: String(row.workspace_id), documentId: String(row.document_id),
    threadId: String(row.thread_id), commentId: String(row.comment_id),
    originShareLinkId: String(row.origin_share_link_id), createdByUserId: String(row.created_by_user_id),
    mentionedUserId: row.mentioned_user_id === null ? null : String(row.mentioned_user_id),
    createdAt: asDate(row.created_at), readAt: asNullableDate(row.read_at),
  };
}
export class MariaDbShareCommentEventsRepository implements ShareCommentEventRepository {
  constructor(private readonly connection: QueryConnection) {}
  async insert(event: ShareCommentEvent): Promise<void> {
    await this.connection.query(
      "INSERT INTO share_comment_events (id,workspace_id,document_id,thread_id,comment_id,origin_share_link_id,created_by_user_id,mentioned_user_id,created_at,read_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      [event.id, event.workspaceId, event.documentId, event.threadId, event.commentId, event.originShareLinkId, event.createdByUserId, event.mentionedUserId, event.createdAt, event.readAt],
    );
  }
  async listUnreadByRecipient(recipientUserId: string): Promise<ShareCommentEvent[]> {
    const rows = await this.connection.query<DbRow[]>(
      `SELECT e.* FROM share_comment_events e JOIN workspaces w ON w.id=e.workspace_id
       WHERE w.personal_owner_user_id=? AND e.read_at IS NULL ORDER BY e.created_at DESC, e.id DESC LIMIT 100`,
      [recipientUserId],
    );
    return rows.map(map);
  }
  async markDocumentRead(recipientUserId: string, documentId: string, at: Date): Promise<void> {
    await this.connection.query(
      `UPDATE share_comment_events e JOIN workspaces w ON w.id=e.workspace_id
       SET e.read_at=? WHERE w.personal_owner_user_id=? AND e.document_id=? AND e.read_at IS NULL`,
      [at, recipientUserId, documentId],
    );
  }
}
```

Wire in `src/infrastructure/database/mariadb/repositories/index.ts`: import the class and add `shareCommentEvents: new MariaDbShareCommentEventsRepository(connection),` beside the review lines. (Owner column verified as `personal_owner_user_id` in `repositories/workspaces.ts`.)

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit 0 (no errors in the new/modified files).

---

### Task 4: Service emission plus owner read/mark-read

**Files:**
- Modify: `src/modules/knowledge/application/document-review-service.ts`
- Test: `tests/integration/share-comment-notify.test.ts`

**Interfaces:**
- Consumes: `ShareCommentEventRepository` via `KnowledgeRepositories` (Task 3); `uuidv7`, `caller.identity.id`, existing `linkScope`/`ownerScope`.
- Produces: `listUnreadForOwner(caller)` → `ShareCommentNotificationView[]`; `markDocumentRead(caller, documentId)` → `void`.

Emission rules (exact):
- In private `create()`: after `r.reviewThreads.insert`, `r.reviewComments.insert`, `charge`, add: `if (originShareLinkId !== null) await r.shareCommentEvents.insert({ id: uuidv7(), workspaceId: s.workspace.id, documentId: s.document.id, threadId: thread.id, commentId: <first-comment id>, originShareLinkId, createdByUserId: caller.identity.id, mentionedUserId: null, createdAt: now, readAt: null })`. The first-comment id is the id inside `this.comment(...)` — hoist it to a `const firstComment = this.comment(...)` before inserting so the same id is reused. The idempotent-replay early return (existing found) must stay above and unchanged: replays insert nothing.
- In private `reply()`: after `insert(comment)` + `charge`, add the same guarded insert with `originShareLinkId = "link" in s ? s.link.id : null`. The `thread.visibility/HIDDEN`, retracted, closed, quota and capacity guards above stay untouched, so hidden/retracted/closed writes still throw before any event. The idempotent-replay early return stays unchanged.
- `edit`, `retract`, `setResolution`, `setVisibility`: no changes.

Read methods:
```ts
async listUnreadForOwner(caller: CallerContext) {
  return this.uow.run(async r => {
    const events = await r.shareCommentEvents.listUnreadByRecipient(caller.identity.id);
    const views = [];
    for (const e of events) {
      const revision = await r.revisions.findCurrent(e.documentId);
      const comments = await r.reviewComments.listByThread(e.threadId);
      const comment = comments.find(c => c.id === e.commentId);
      if (!revision || !comment || comment.deletedAt || comment.visibility === "HIDDEN") continue;
      const author = await r.users.findById(e.createdByUserId);
      views.push(projectShareCommentNotification({ id: e.id, workspaceId: e.workspaceId, documentId: e.documentId, documentTitle: revision.title, threadId: e.threadId, commentId: e.commentId, authorName: author?.name, body: comment.body, createdAt: e.createdAt }));
    }
    return { notifications: views };
  });
}
```
(`revision.title`: the title lives on the revision, never the document — identity vs position vs content invariant.)

```ts
async markDocumentRead(caller: CallerContext, documentId: string) {
  await this.uow.run(async r => {
    await this.ownerScope(r, caller, documentId, false);
    await r.shareCommentEvents.markDocumentRead(caller.identity.id, documentId, this.clock());
  });
}
```

- [ ] **Step 1: Write the failing integration test** (`tests/integration/share-comment-notify.test.ts`), mirroring the fixture in `tests/integration/document-review-service.test.ts` (owner + reviewer identities, personal workspace, hub source, created document, two share links, review anchor):

```ts
// cases: (a) createForLink inserts one unread event for the owner;
// (b) owner reply inserts nothing; (c) idempotent create replay inserts nothing;
// (d) edit/retract/resolve produce no new events;
// (e) markDocumentRead clears the badge; (f) non-owner markDocumentRead throws SHARE_LINK_NOT_FOUND;
// (g) revoked-link write attempt throws and inserts no event.
```

Follow the existing file's pool setup verbatim (`createDatabasePool(databaseConfig("test"))`, `MariaDbUnitOfWork`, `PersonalWorkspaceService.ensurePersonalWorkspace`, `HubKnowledgeCommandServiceImpl.createDocument`, `RandomShareTokenIssuer` + `DocumentShareService.create`).

- [ ] **Step 2: Run test to verify it fails**

Run: `make test-integration`
Expected: FAIL (the new test file fails — service has no emission yet and `shareCommentEvents` is unwired; the rest of the suite passes).

- [ ] **Step 3: Implement the service changes** (exact edits above).

- [ ] **Step 4: Run the new test plus the existing review suite**

Run: `make test-integration`
Expected: all PASS (the runner provisions one isolated DB and runs every integration file, including the four review files).

---

### Task 5: HTTP routes (thin wrappers, no new anonymous entry)

**Files:**
- Create: `src/app/api/review-notifications/unread/route.ts`
- Create: `src/app/api/review-notifications/mark-read/route.ts`

**Interfaces:**
- Consumes: `reviewHttp` from `@/server/review-http`; `listUnreadForOwner`, `markDocumentRead` (Task 4).
- Produces: `GET /api/review-notifications/unread` → `{ notifications }`; `POST /api/review-notifications/mark-read` with `{ documentId }` → `{ ok: true }`.

```ts
// unread/route.ts
import { reviewHttp } from "@/server/review-http";
export async function GET(request: Request) {
  return reviewHttp(request, async (service, caller) => service.listUnreadForOwner(caller));
}
// mark-read/route.ts
import { reviewBody, reviewHttp } from "@/server/review-http";
export async function POST(request: Request) {
  return reviewHttp(request, async (service, caller) => {
    const body = await reviewBody(request);
    if (typeof body.documentId !== "string" || !body.documentId) {
      const { DomainError } = await import("@/shared/domain/errors");
      throw new DomainError("INVALID_REQUEST", "Provide a document id.");
    }
    await service.markDocumentRead(caller, body.documentId);
    return { ok: true };
  });
}
```

- [ ] **Step 1: Write the failing route tests** (`tests/unit/review-notifications-routes.test.ts`), mirroring the mock pattern at the top of `tests/unit/review-http.test.ts`:

```ts
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ services: vi.fn() }));
vi.mock("@/server/composition", () => ({ applicationServices: mocks.services }));
import { GET as unread } from "@/app/api/review-notifications/unread/route";
import { POST as markRead } from "@/app/api/review-notifications/mark-read/route";
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
function authed(notifications: unknown[] = []) {
  mocks.services.mockResolvedValue({
    establishTrustedCaller: async () => ({ caller: { identity: { id: "owner-1" } } }),
    reviews: {
      listUnreadForOwner: async () => ({ notifications }),
      markDocumentRead: async () => {},
    },
  });
}
describe("review notification routes", () => {
  it("GET unread returns the owner's notifications", async () => {
    authed([{ id: "e1" }]);
    const response = await unread(new Request("http://127.0.0.1:3000/api/review-notifications/unread"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ notifications: [{ id: "e1" }] });
  });
  it("POST mark-read rejects a missing documentId", async () => {
    authed();
    const response = await markRead(new Request("http://127.0.0.1:3000/api/review-notifications/mark-read", { method: "POST", headers: { Origin: "http://127.0.0.1:3000" }, body: JSON.stringify({}) }));
    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).toContain("INVALID_REQUEST");
  });
  it("POST mark-read accepts a documentId", async () => {
    authed();
    const response = await markRead(new Request("http://127.0.0.1:3000/api/review-notifications/mark-read", { method: "POST", headers: { Origin: "http://127.0.0.1:3000" }, body: JSON.stringify({ documentId: "d1" }) }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });
});
```

Note: `reviewBody` throws `DomainError("INVALID_REQUEST", ...)` for non-object JSON; `toWorkspaceErrorResponse` maps it to 400 — if the mapped status differs, assert the actual status from a first run and keep it (do not change the route to fit the test).
- [ ] **Step 2: Run unit suite** — `make test-unit`. Expected: PASS.
- [ ] **Step 3: Lint the new routes** — `make lint` (or `npx eslint src/app/api/review-notifications/`). Expected: clean.

---

### Task 6: Owner UI badge and mark-read hook

**Files:**
- Create: `src/components/knowledge/share-comment-notifications.ts`
- Modify: `src/components/knowledge/owner-review-panel.tsx`

**Interfaces:**
- Consumes: the two routes (Task 5); existing `reviewRequest` helper style from `./review-thread-list`.
- Produces: `useShareCommentUnread(documentId)` hook returning `{ unreadCount, refresh, markRead }`.

Hook behavior: fetch `/api/review-notifications/unread` on mount and when `documentId` changes; `markRead` POSTs `{ documentId }` and refreshes. Fetch failure shows no badge (silent, never blocks the panel); mark-read failure retries once in the background, then drops it.

Panel change: in `OwnerReviewPanel`, after `load()` resolves threads successfully, call `markRead()` for this `documentId`; render the unread count for this document as a badge beside the panel header entry (reuse `Button`/`Tooltip` and the frontend-design-language tokens `text-body`, `rounded-md`, `shadow-popover` — never Tailwind defaults like `text-sm`/`rounded`/`shadow-sm`, which do not exist in this repo).

- [ ] **Step 1: Implement hook + panel wiring.**
- [ ] **Step 2: Run existing review client/unit tests** — `npx vitest run --config vitest.config.ts tests/unit/review-client.test.ts tests/unit/review-auto-open.test.ts`. Expected: PASS.
- [ ] **Step 3: Manual check in dev** — `make dev`, owner opens a commented document: badge appears, list opens, badge clears on reload.

---

### Task 7: E2E and final verification

**Files:**
- Create: `tests/e2e/share-comment-notify.spec.ts` (mirror `tests/e2e/shared-review.spec.ts` + `tests/e2e/fixtures/document-review.ts` patterns: owner creates link, holder comments on `/s/:token`, owner home/panel shows unread, owner opens panel, unread clears).

- [ ] **Step 1: Write the spec.**
- [ ] **Step 2: Run it** — `make browsers` (once), then `npm run test:e2e -- share-comment-notify.spec.ts` (provisions an isolated DB, builds, runs the single spec). Expected: PASS.
- [ ] **Step 3: Run the full gate** — `make verify` (unit + typecheck + lint + build). Expected: exit 0. Then `make test-integration`. Expected: PASS with no new failures.
- [ ] **Step 4: Report** — spec path, plan path, test evidence (commands + results). Do not commit unless the user explicitly asks.

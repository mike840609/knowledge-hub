# Document Share Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** My Space owners can create expiring, revocable read-only links for individual documents; anyone with a link can read the document's current revision at `/s/:token` without signing in.

**Architecture:** Add a link table and daily view-count table (migration 011), with rules as pure functions in the `knowledge` module domain layer, coordinated by a new `DocumentShareService`. `readShared(token)` is the codebase's only method that returns document content without accepting `CallerContext`, obtained through a separate composition entry that does not construct an identity provider. UI adds an action through the existing action registry and opens a share dialog through a window event, following the `document.open-details` pattern.

**Tech Stack:** Next.js 15 App Router、React 19、TypeScript、Tailwind、MariaDB 10.11、vitest 2、Playwright 1.55、`@base-ui-components/react` Dialog。

**Spec:** `docs/superpowers/specs/2026-09-23-document-share-link-design.md`(A0–A5 all decided)

## Global Constraints

- **Tokens always use `crypto.randomUUID()` (UUIDv4)** through the `ShareTokenIssuer` port. Never generate tokens with `uuidv7()` (spec §8: sequential within the same millisecond). Link primary-key `id` and audit-event `id` still use `uuidv7()`.
- **Do not store `workspace_id`/`source_id`**: always derive scope through `Document → Source → Workspace` (CLAUDE.md “Scope is derived”).
- **Ownership is not a condition**: `SOURCE_MANAGED` documents can be shared. No task may add an ownership check.
- **`readShared` has no caller parameter**; all other methods returning document content must require membership (enforced by Task 6 source-scan tests).
- Lock order for creation and revocation: `Source FOR UPDATE → Workspace FOR UPDATE` (Phase 3 §14.2 “non-import existing Source”).
- Creation/revocation audit events share the mutation transaction; payloads never contain tokens.
- Write view counts in a **separate** transaction; on failure only `console.warn` (no token in the message), and still return content (A5).
- Expiry accepts only `1 | 7 | 30 | 90` days, default 30; maximum 10 active links per document; labels at most 200 characters.
- API returns `path` (`/s/<token>`), not a full URL; the browser constructs the full link using `window.location.origin`.
- New UI uses only tokens listed in `frontend-design-language.md`; colors come only from CSS variables in `globals.css`.
- **Test commands**: unit can target one file (`npm run test:unit -- <path>`); integration runs only as a full suite (`npm run test:integration`; `scripts/test/integration.ts` does not forward arguments); e2e can target one file (`npm run test:e2e -- <path>`).
- `npm run typecheck && npm run lint` must be clean before every task ends.

---

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `src/infrastructure/database/mariadb/migrations/011-document-share-links.ts`(new) | Two new tables | 1 |
| `src/infrastructure/database/mariadb/migrations/index.ts`(modify) | Register migration 011 | 1 |
| `src/modules/knowledge/domain/document-share-link.ts`(new) | Constants, types, errors, creation/validity pure functions, UUIDv4 format validation | 2 |
| `src/modules/knowledge/ports/document-share-link-repository.ts`(new) | Repository port for links and view counts | 3 |
| `src/modules/knowledge/ports/share-token-issuer.ts`(new) | Token generation port | 3 |
| `src/modules/knowledge/ports/unit-of-work.ts`(modify) | Add `shareLinks`, `auditEvents` to `KnowledgeRepositories` | 3 |
| `src/infrastructure/database/mariadb/repositories/document-share-links.ts`(new) | MariaDB implementation | 3 |
| `src/infrastructure/database/mariadb/repositories/index.ts`(modify) | Assemble `shareLinks` | 3 |
| `src/infrastructure/security/random-share-token-issuer.ts`(new) | `crypto.randomUUID()` adapter | 3 |
| `src/modules/knowledge/application/document-share-service.ts`(new) | `create`／`list`／`revoke`／`readShared` | 4、5 |
| `src/server/http-error-response.ts`(modify) | Status-code mapping for new error codes | 6 |
| `src/server/composition.ts`(modify) | `applicationServices().shares` and separate `shareReadService()` | 6 |
| `src/app/api/documents/[documentId]/share-links/route.ts`(new) | `POST`、`GET` | 7 |
| `src/app/api/share-links/[linkId]/revoke/route.ts`(new) | `POST` | 7 |
| `src/server/share-read.ts`(new) | Read projection for `/s/:token` | 8 |
| `src/app/s/[token]/page.tsx`(new) | Public Reading Page | 8 |
| `src/app/s/[token]/not-found.tsx`(new) | Uniform Unavailable Page | 8 |
| `next.config.ts`(modify) | Response headers for `/s/:path*` | 8 |
| `src/components/actions/action-registry.ts`(modify) | `document.share` | 9 |
| `src/components/actions/action-icon.tsx`(modify) | `share` icon | 9 |
| `src/components/actions/action-menu.tsx`(modify) | `document.open-share` → `kh:request-share` | 9 |
| `src/components/knowledge/share-link-dialog.tsx`(new) | Share Dialog | 10 |
| `src/components/knowledge/knowledge-layout.tsx`(modify) | Mount dialog host | 10 |
| `src/components/knowledge/document-header.tsx`(modify) | Header Share link button | 10 |
| `tests/e2e/share-link.spec.ts`(new) | E2E | 11 |
| `CLAUDE.md`、Phase 3 spec、`README.md`(modify) | Contract Changes | 12 |
| `docs/superpowers/verification/2026-09-23-document-share-link.md`(new) | Verification record and rollout checklist | 12 |

---

### Task 1: Migration 011

**Files:**
- Create: `src/infrastructure/database/mariadb/migrations/011-document-share-links.ts`
- Modify: `src/infrastructure/database/mariadb/migrations/index.ts`
- Test: `tests/integration/share-link-schema.test.ts`

**Interfaces:**
- Produces: `documentShareLinksMigration: Migration`（`version: 11`）

- [ ] **Step 1: Write failing tests**

```typescript
// tests/integration/share-link-schema.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";

let pool: Pool;
beforeAll(() => { pool = createDatabasePool(databaseConfig("test")); });
afterAll(async () => { await pool.end(); });

async function columns(table: string): Promise<string[]> {
  const rows = await pool.query<{ COLUMN_NAME: string }[]>(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION", [table]);
  return rows.map((row) => row.COLUMN_NAME);
}

describe("migration 011 (spec §7)", () => {
  it("stores no workspace or source scope on the link", async () => {
    const names = await columns("document_share_links");
    expect(names).toEqual(["id", "document_id", "token", "label", "created_by", "created_at", "expires_at", "revoked_by", "revoked_at"]);
    expect(names).not.toContain("workspace_id");
    expect(names).not.toContain("source_id");
  });

  it("records views without any viewer-identifying column", async () => {
    expect(await columns("document_share_link_views"))
      .toEqual(["share_link_id", "view_date", "first_viewed_at", "last_viewed_at", "view_count"]);
  });
});
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `npm run test:integration`
Expected: FAIL — `document_share_links` does not exist.

- [ ] **Step 3: Implement**

`011-document-share-links.ts` creates two tables using spec §7.1/§7.2 DDL (`token UUID NOT NULL` + `uq_share_links_token`, two CHECKs, `idx_share_links_document`; views table PK `(share_link_id, view_date)`). Append `documentShareLinksMigration` to the `migrations` array in `index.ts`.

- [ ] **Step 4: Run tests and confirm success**

Run: `npm run test:integration`
Expected: PASS; no regressions in existing migration runner tests.

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/database/mariadb/migrations tests/integration/share-link-schema.test.ts
git commit -m "feat(db): migration 011 for document share links"
```

---

### Task 2: Domain Pure Functions

All rules live here without I/O, allowing every rule in spec §5.1/§5.2 to be tested independently.

**Files:**
- Create: `src/modules/knowledge/domain/document-share-link.ts`
- Test: `tests/unit/share-link-domain.test.ts`

**Interfaces:**
- Consumes: `ROLE_WORKSPACE_CAPABILITIES`、`WorkspaceRole`（`@/modules/workspaces/domain/…`）
- Produces:

```typescript
export const SHARE_LINK_EXPIRY_DAYS = [1, 7, 30, 90] as const;
export type ShareLinkExpiryDays = (typeof SHARE_LINK_EXPIRY_DAYS)[number];
export const DEFAULT_SHARE_LINK_EXPIRY_DAYS: ShareLinkExpiryDays = 30;
export const MAX_ACTIVE_SHARE_LINKS_PER_DOCUMENT = 10;
export const MAX_SHARE_LINK_LABEL_LENGTH = 200;

export type DocumentShareLink = {
  id: string; documentId: string; token: string; label: string | null;
  createdBy: string; createdAt: Date; expiresAt: Date;
  revokedBy: string | null; revokedAt: Date | null;
};

/** Everything validity depends on, already loaded. Never includes the viewer. */
export type ShareLinkValidityInput = {
  link: Pick<DocumentShareLink, "revokedAt" | "expiresAt">;
  documentStatus: "ACTIVE" | "ARCHIVED";
  sourceStatus: "ACTIVE" | "ARCHIVED";
  workspaceLifecycle: "ACTIVE" | "ARCHIVED" | null | undefined;
  /** The creator's DIRECT role on the owning workspace; undefined = no row. */
  creatorDirectRole: WorkspaceRole | null | undefined;
  now: Date;
};
export type ShareLinkInvalidReason =
  | "REVOKED" | "EXPIRED" | "DOCUMENT_ARCHIVED" | "SOURCE_ARCHIVED" | "WORKSPACE_ARCHIVED" | "CREATOR_LOST_ACCESS";
/** Reasons are for tests and logs only; callers must never surface them (spec §6.3). */
export function evaluateShareLinkValidity(input: ShareLinkValidityInput): { valid: true } | { valid: false; reason: ShareLinkInvalidReason };

export function isActiveShareLink(link: Pick<DocumentShareLink, "revokedAt" | "expiresAt">, now: Date): boolean;

export type ShareLinkCreationInput = {
  callerId: string;
  documentStatus: "ACTIVE" | "ARCHIVED";
  sourceStatus: "ACTIVE" | "ARCHIVED";
  workspace: { workspaceType?: "PERSONAL" | "TEAM" | null; personalOwnerUserId?: string | null; lifecycleState?: "ACTIVE" | "ARCHIVED" | null };
  activeLinkCount: number;
  expiresInDays: unknown;
  label: unknown;
};
/** Throws the first failing rule's error; returns the normalized input. */
export function assertShareLinkCreation(input: ShareLinkCreationInput): { expiresInDays: ShareLinkExpiryDays; label: string | null };

export function shareLinkExpiry(now: Date, days: ShareLinkExpiryDays): Date;
/** UUIDv4 only; used to reject malformed tokens before any query. */
export function isShareToken(value: string): boolean;
export function shareLinkPath(token: string): string; // `/s/${token}`

export class ShareLinkNotPersonalError extends DomainError {}      // code SHARE_LINK_NOT_PERSONAL
export class ShareLinkLimitReachedError extends DomainError {}     // code SHARE_LINK_LIMIT_REACHED
export class InvalidShareLinkExpiryError extends KnowledgeError {} // code INVALID_SHARE_LINK_EXPIRY
export class InvalidShareLinkLabelError extends KnowledgeError {}  // code INVALID_SHARE_LINK_LABEL
export class ShareLinkNotFoundError extends NotFoundError {}       // code SHARE_LINK_NOT_FOUND
```

`assertShareLinkCreation` check order and errors:
1. `documentStatus`／`sourceStatus` not ACTIVE → `DocumentArchivedError`／`SourceArchivedError`(existing)
2. `workspaceType !== "PERSONAL"` → `ShareLinkNotPersonalError`
3. `personalOwnerUserId !== callerId` → `DocumentNotFoundError`(do not disclose existence)
4. `lifecycleState !== "ACTIVE"` → `WorkspaceArchivedError`(existing, `@/modules/workspaces/domain/errors`)
5. `activeLinkCount >= 10` → `ShareLinkLimitReachedError`
6. `expiresInDays` outside the list → `InvalidShareLinkExpiryError`; `undefined` uses default 30
7. Non-string `label` or over 200 after trimming → `InvalidShareLinkLabelError`; normalize empty strings to `null`

Determine creator read access from `creatorDirectRole`: `role` of `null` (legacy row), or any `ROLE_WORKSPACE_CAPABILITIES[role]` containing `document.read`, grants access; `undefined` does not.

- [ ] **Step 1: Write failing tests**

```typescript
// tests/unit/share-link-domain.test.ts
import { describe, expect, it } from "vitest";
import {
  assertShareLinkCreation, evaluateShareLinkValidity, isShareToken, shareLinkExpiry,
  type ShareLinkCreationInput, type ShareLinkValidityInput,
} from "@/modules/knowledge/domain/document-share-link";

const now = new Date("2026-09-23T00:00:00Z");

function validity(overrides: Partial<ShareLinkValidityInput> = {}): ShareLinkValidityInput {
  return {
    link: { revokedAt: null, expiresAt: new Date("2026-10-01T00:00:00Z") },
    documentStatus: "ACTIVE", sourceStatus: "ACTIVE", workspaceLifecycle: "ACTIVE",
    creatorDirectRole: "OWNER", now, ...overrides,
  };
}

describe("evaluateShareLinkValidity (spec §5.2)", () => {
  it("is valid when every condition holds", () => {
    expect(evaluateShareLinkValidity(validity())).toEqual({ valid: true });
  });

  it.each([
    ["REVOKED", { link: { revokedAt: now, expiresAt: new Date("2026-10-01T00:00:00Z") } }],
    ["EXPIRED", { link: { revokedAt: null, expiresAt: now } }],
    ["DOCUMENT_ARCHIVED", { documentStatus: "ARCHIVED" }],
    ["SOURCE_ARCHIVED", { sourceStatus: "ARCHIVED" }],
    ["WORKSPACE_ARCHIVED", { workspaceLifecycle: "ARCHIVED" }],
    ["CREATOR_LOST_ACCESS", { creatorDirectRole: undefined }],
  ] as const)("fails with %s when only that condition fails", (reason, overrides) => {
    expect(evaluateShareLinkValidity(validity(overrides as Partial<ShareLinkValidityInput>))).toEqual({ valid: false, reason });
  });

  it("treats expiry as exclusive: a link expiring exactly now is invalid", () => {
    expect(evaluateShareLinkValidity(validity({ link: { revokedAt: null, expiresAt: now } })).valid).toBe(false);
  });
});

function creation(overrides: Partial<ShareLinkCreationInput> = {}): ShareLinkCreationInput {
  return {
    callerId: "owner", documentStatus: "ACTIVE", sourceStatus: "ACTIVE",
    workspace: { workspaceType: "PERSONAL", personalOwnerUserId: "owner", lifecycleState: "ACTIVE" },
    activeLinkCount: 0, expiresInDays: undefined, label: undefined, ...overrides,
  };
}

describe("assertShareLinkCreation (spec §5.1)", () => {
  it("defaults expiry to 30 days and an empty label to null", () => {
    expect(assertShareLinkCreation(creation({ label: "  " }))).toEqual({ expiresInDays: 30, label: null });
  });

  it("rejects a Team document", () => {
    expect(() => assertShareLinkCreation(creation({ workspace: { workspaceType: "TEAM", personalOwnerUserId: null, lifecycleState: "ACTIVE" } })))
      .toThrow(expect.objectContaining({ code: "SHARE_LINK_NOT_PERSONAL" }));
  });

  it("hides another user's My Space document as not found", () => {
    expect(() => assertShareLinkCreation(creation({ callerId: "someone-else" })))
      .toThrow(expect.objectContaining({ code: "DOCUMENT_NOT_FOUND" }));
  });

  it("rejects the eleventh active link", () => {
    expect(() => assertShareLinkCreation(creation({ activeLinkCount: 10 })))
      .toThrow(expect.objectContaining({ code: "SHARE_LINK_LIMIT_REACHED" }));
  });

  it.each([0, 2, 365, "30", null])("rejects expiry %j", (expiresInDays) => {
    expect(() => assertShareLinkCreation(creation({ expiresInDays })))
      .toThrow(expect.objectContaining({ code: "INVALID_SHARE_LINK_EXPIRY" }));
  });

  it("rejects a label over 200 characters", () => {
    expect(() => assertShareLinkCreation(creation({ label: "x".repeat(201) })))
      .toThrow(expect.objectContaining({ code: "INVALID_SHARE_LINK_LABEL" }));
  });

  it("rejects archived documents and sources", () => {
    expect(() => assertShareLinkCreation(creation({ documentStatus: "ARCHIVED" }))).toThrow(expect.objectContaining({ code: "DOCUMENT_ARCHIVED" }));
    expect(() => assertShareLinkCreation(creation({ sourceStatus: "ARCHIVED" }))).toThrow(expect.objectContaining({ code: "SOURCE_ARCHIVED" }));
  });
});

describe("tokens", () => {
  it("accepts only UUIDv4", () => {
    expect(isShareToken("3b241101-e2bb-4255-8caf-4136c566a962")).toBe(true);
    expect(isShareToken("01a0cdb5-9d1b-70a3-93e0-43bbf50ed31f")).toBe(false); // v7
    expect(isShareToken("not-a-token")).toBe(false);
  });

  it("computes expiry in whole days from creation", () => {
    expect(shareLinkExpiry(now, 7).toISOString()).toBe("2026-09-30T00:00:00.000Z");
  });
});
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `npm run test:unit -- tests/unit/share-link-domain.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement** `document-share-link.ts`, following Interfaces above. `isShareToken` uses `/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i`。

- [ ] **Step 4: Run tests and confirm success**

Run: `npm run test:unit -- tests/unit/share-link-domain.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/knowledge/domain/document-share-link.ts tests/unit/share-link-domain.test.ts
git commit -m "feat(knowledge): share-link creation and validity rules as pure functions"
```

---

### Task 3: Ports and MariaDB Repository

**Files:**
- Create: `src/modules/knowledge/ports/document-share-link-repository.ts`、`src/modules/knowledge/ports/share-token-issuer.ts`
- Create: `src/infrastructure/database/mariadb/repositories/document-share-links.ts`、`src/infrastructure/security/random-share-token-issuer.ts`
- Modify: `src/modules/knowledge/ports/unit-of-work.ts`、`src/infrastructure/database/mariadb/repositories/index.ts`
- Test: Covered by Tasks 4/5 integration tests; this task needs only typecheck

**Interfaces:**

```typescript
// ports/document-share-link-repository.ts
export type ShareLinkDailyViews = { viewDate: string /* YYYY-MM-DD, UTC */; viewCount: number; lastViewedAt: Date };
export interface DocumentShareLinkRepository {
  insert(link: DocumentShareLink): Promise<void>;
  findByToken(token: string): Promise<DocumentShareLink | null>;
  lockById(id: string): Promise<DocumentShareLink | null>;
  listByDocument(documentId: string): Promise<DocumentShareLink[]>;          // created_at DESC
  countActiveByDocument(documentId: string, now: Date): Promise<number>;
  revoke(id: string, revokedBy: string, revokedAt: Date): Promise<void>;     // WHERE revoked_at IS NULL; affectedRows must equal 1
  listDailyViews(linkIds: readonly string[]): Promise<Map<string, ShareLinkDailyViews[]>>;
  recordView(linkId: string, at: Date): Promise<void>;                       // INSERT … ON DUPLICATE KEY UPDATE
}

// ports/share-token-issuer.ts
export interface ShareTokenIssuer { issue(): string } // must return a UUIDv4
```

Add to `KnowledgeRepositories`:

```typescript
  shareLinks: DocumentShareLinkRepository;
  /** Share-link create/revoke append governance events in the same transaction (spec §7.3). */
  auditEvents: WorkspaceAuditEventRepository;
```

`createRepositories()` already returns `auditEvents`; add only `shareLinks: new MariaDbDocumentShareLinkRepository(connection)` and include `DocumentShareLinkRepository` in the type chain extended by `SourceRepositories` (automatically included if defined as `KnowledgeRepositories &`; otherwise add the field there too).

SQL for `recordView`:

```sql
INSERT INTO document_share_link_views (share_link_id, view_date, first_viewed_at, last_viewed_at, view_count)
VALUES (?, DATE(?), ?, ?, 1)
ON DUPLICATE KEY UPDATE last_viewed_at = VALUES(last_viewed_at), view_count = view_count + 1
```

Calculate `view_date` in UTC: the service converts supplied `at` to a string with `at.toISOString().slice(0, 10)` before binding, independent of connection timezone.

`RandomShareTokenIssuer.issue()` returns `randomUUID()` (`node:crypto`). `src/modules/**` must not import it; inject it only at the composition root.

- [ ] **Step 1: Create ports and types**; expect `npm run typecheck` to fail because `createRepositories` lacks a field.
- [ ] **Step 2: Implement repository and issuer**; wire up `createRepositories`.
- [ ] **Step 3:** `npm run typecheck && npm run lint` clean。
- [ ] **Step 4: Commit**

```bash
git add src/modules/knowledge/ports src/infrastructure
git commit -m "feat(knowledge): share-link repository and UUIDv4 token issuer"
```

---

### Task 4: `create`／`list`／`revoke`

**Files:**
- Create: `src/modules/knowledge/application/document-share-service.ts`
- Test: `tests/integration/share-link-service.test.ts`

**Interfaces:**

```typescript
export type ShareLinkView = {
  id: string; label: string | null; path: string;
  createdAt: Date; expiresAt: Date; revokedAt: Date | null; active: boolean;
  totalViews: number; lastViewedAt: Date | null;
};
export type SharedDocumentView = { title: string; markdown: string; sharedByName: string; updatedAt: Date; expiresAt: Date };

export class DocumentShareService {
  constructor(unitOfWork: KnowledgeUnitOfWork, tokens: ShareTokenIssuer, clock?: () => Date);
  create(caller: CallerContext, input: { documentId: string; label?: unknown; expiresInDays?: unknown }): Promise<ShareLinkView>;
  list(caller: CallerContext, documentId: string): Promise<ShareLinkView[]>;
  revoke(caller: CallerContext, linkId: string): Promise<void>;
  readShared(token: string): Promise<SharedDocumentView>; // Task 5
}
```

Steps for `create` (one `unitOfWork.run`):

```text
upsertIdentity(caller.identity)
document = documents.findById(documentId)            → absent: DocumentNotFoundError
source   = sourcePolicy.lockById(document.sourceId)  ← Source FOR UPDATE
workspace = workspaces.lockById(source.workspaceId)  ← Workspace FOR UPDATE
requireMembership(caller, workspace.id)              → non-member: rethrow unchanged (mapped to 404)
normalized = assertShareLinkCreation({ …, activeLinkCount: shareLinks.countActiveByDocument(documentId, now) })
link = { id: uuidv7(), token: tokens.issue(), … , expiresAt: shareLinkExpiry(now, normalized.expiresInDays) }
if (!isShareToken(link.token)) throw new IntegrityViolationError(…)   ← prevent replacement with a non-v4 issuer
shareLinks.insert(link)
auditEvents.append({ eventType: "DOCUMENT_SHARE_LINK_CREATED", targetType: "DOCUMENT_SHARE_LINK", targetId: link.id,
                     workspaceId: workspace.id, actorKind: "USER", actorUserId: caller.identity.id,
                     payload: { documentId, expiresAt: link.expiresAt.toISOString(), label: link.label }, … })
```

`list`: check equivalent to `requireVisibleDocument` (member and PERSONAL owner, otherwise `DocumentNotFoundError`); return all document links (including revoked/expired, distinguished by `active`) and aggregated view counts.

`revoke`: `shareLinks.lockById` → absent: `ShareLinkNotFoundError` → document → `Source FOR UPDATE` → `Workspace FOR UPDATE` → `link.createdBy !== caller.identity.id`: `ShareLinkNotFoundError` → already revoked: no-op return (idempotent) → `revoke` + audit `DOCUMENT_SHARE_LINK_REVOKED`, payload `{ documentId }`.

> Lock-order note: `revoke` locks the link row before Source/Workspace. The link table is absent from existing Phase 3 §14.2 paths, and no other path locks a link row while holding Source/Workspace locks, so no inversion occurs. If a future path needs this, first `findById` (without locking) to obtain documentId, lock Source → Workspace, then `lockById`.

- [ ] **Step 1: Write failing tests**(`tests/integration/share-link-service.test.ts`; fixtures follow `phase5-authoring-service.test.ts`: create My Space with `PersonalWorkspaceService.ensurePersonalWorkspace`, and documents with `ensureDefaultHubSource` + `HubKnowledgeCommandServiceImpl.createDocument`)

Must cover:
  - Owner creates → returned `path` starts with `/s/`, token is UUIDv4, `expiresAt` = creation time + 30 days
  - Create two consecutively → tokens are not adjacent (`BigInt` difference is not ±1), and neither equals same-row `id` or `document_id`
  - Non-owner (another user) → `DocumentNotFoundError`, no new rows in `document_share_links` or `workspace_audit_events`
  - Team document (caller is Team OWNER) → `SHARE_LINK_NOT_PERSONAL`, no new rows
  - 11th link → `SHARE_LINK_LIMIT_REACHED`; revoke one and creation is allowed again
  - `SOURCE_MANAGED` document (folder-import fixture or directly inserted FOLDER_SYNC source) → creation allowed
  - Audit: one `DOCUMENT_SHARE_LINK_CREATED`, payload has no token string
  - Atomicity: wrap unit of work with a double whose `auditEvents.append` throws → link does not exist either
  - `revoke`: non-creator → `SHARE_LINK_NOT_FOUND`; repeated revocation → no error, exactly one REVOKED audit
  - `list`: includes revoked links with `active: false`; each has `path`

- [ ] **Step 2: Run tests and confirm failure** — `npm run test:integration`
- [ ] **Step 3: Implement** `create`／`list`／`revoke`
- [ ] **Step 4: Run tests and confirm success** — `npm run test:integration`
- [ ] **Step 5: Commit**

```bash
git add src/modules/knowledge/application/document-share-service.ts tests/integration/share-link-service.test.ts
git commit -m "feat(knowledge): create, list and revoke share links with audit"
```

---

### Task 5: `readShared`

**Files:**
- Modify: `src/modules/knowledge/application/document-share-service.ts`
- Modify: `tests/integration/share-link-service.test.ts`

**Interfaces:**
- Produces: `readShared(token: string): Promise<SharedDocumentView>`; all invalid states throw `ShareLinkNotFoundError`

Steps:

```text
if (!isShareToken(token)) throw new ShareLinkNotFoundError()      ← no DB lookup
view = unitOfWork.run(repos => {
  link = shareLinks.findByToken(token)                            → absent: ShareLinkNotFoundError
  document = documents.findById(link.documentId)
  source = sourcePolicy.findById(document.sourceId)
  workspace = workspaces.findById(source.workspaceId)
  membership = workspaceMemberships.find(workspace.id, link.createdBy)
  verdict = evaluateShareLinkValidity({ …, creatorDirectRole: membership ? membership.role ?? null : undefined, now })
  if (!verdict.valid) throw new ShareLinkNotFoundError()
  revision = revisions.findCurrent(document.id)                   → absent: IntegrityViolationError
  creator = users.findById(link.createdBy)
  return { title: revision.title, markdown: revision.markdown, sharedByName: creator.name,
           updatedAt: revision.createdAt, expiresAt: link.expiresAt, linkId: link.id }
})
try { await unitOfWork.run(repos => repos.shareLinks.recordView(view.linkId, now)) }
catch { console.warn("Share link view count was not recorded.") }   ← no token or information beyond linkId
return view (remove linkId)
```

Do not call `users.upsertIdentity`, `workspaceAccess.requireMembership`, or any method accepting `CallerContext`.

- [ ] **Step 1: Write failing tests**; add:
  - Valid link → return current revision title/markdown and owner name
  - Read after owner calls `createRevision` → return new content (A2)
  - After revocation, setting `expires_at` to the past via SQL, document `updateStatus("ARCHIVED")`, source archival, or deleting creator membership via raw SQL → always `SHARE_LINK_NOT_FOUND`
  - Malformed token → `SHARE_LINK_NOT_FOUND`; use a unit-of-work double to assert `run` was not called
  - Three reads in one day → one `document_share_link_views` row, `view_count = 3`
  - Double `recordView` throws → `readShared` still returns content
- [ ] **Step 2: Run tests and confirm failure** — `npm run test:integration`
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run tests and confirm success** — `npm run test:integration`
- [ ] **Step 5: Commit**

```bash
git commit -am "feat(knowledge): read a shared document by token without a caller"
```

---

### Task 6: Error Mapping, Composition, and “Single Exception” Source-Scan Tests

**Files:**
- Modify: `src/server/http-error-response.ts`、`src/server/composition.ts`
- Test: `tests/unit/share-link-error-mapping.test.ts`、`tests/unit/share-link-single-exception.test.ts`

**Interfaces:**
- `toWorkspaceErrorResponse`: add `SHARE_LINK_NOT_FOUND` to `WORKSPACE_HIDDEN_NOT_FOUND` (404 `NOT_FOUND`); `SHARE_LINK_NOT_PERSONAL`, `SHARE_LINK_LIMIT_REACHED` → 409; `INVALID_SHARE_LINK_EXPIRY`, `INVALID_SHARE_LINK_LABEL` → 400
- Add to `buildApplicationServices()` return value:  `shares: new DocumentShareService(unitOfWork, new RandomShareTokenIssuer())`
- Add `export function shareReadService(): Pick<DocumentShareService, "readShared">`: use only `getPool()` to construct `MariaDbUnitOfWork` and `DocumentShareService`; **do not call** `createIdentityProvider`, `applicationServices()`, or readiness checks; cache in a `globalThis` slot and clear with `closeApplicationPool()`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/unit/share-link-single-exception.test.ts
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Spec §6.1: readShared is the only method that returns document content
 * without a caller. Every other public method of a knowledge application
 * service that can return revision content must take a CallerContext.
 */
describe("share link is the single caller-less content path", () => {
  const root = "src/modules/knowledge/application";
  const files = readdirSync(root).filter((name) => name.endsWith(".ts")).map((name) => path.join(root, name));

  it("finds readShared as the only public async method without a caller parameter that mentions markdown", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/^\s{2}async (\w+)\(([^)]*)\)/gm)) {
        const [, name, parameters] = match;
        if (name.startsWith("require") || parameters.includes("caller")) continue;
        const body = source.slice(match.index ?? 0, source.indexOf("\n  }\n", match.index ?? 0));
        if (/markdown/.test(body)) offenders.push(`${path.basename(file)}#${name}`);
      }
    }
    expect(offenders).toEqual(["document-share-service.ts#readShared"]);
  });
});
```

Error-mapping tests follow Phase 5 Task 1 `phase5-error-mapping.test.ts`, asserting each status code and that the body code for `SHARE_LINK_NOT_FOUND` is `NOT_FOUND`.

- [ ] **Step 2: Run tests and confirm failure** — `npm run test:unit -- tests/unit/share-link-error-mapping.test.ts tests/unit/share-link-single-exception.test.ts`
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run tests and confirm success**; also run the complete `npm run test:unit` suite to confirm no regressions
- [ ] **Step 5: Commit**

```bash
git commit -am "feat(server): wire share links, map their errors, and lock the single caller-less path"
```

---

### Task 7: Management API

**Files:**
- Create: `src/app/api/documents/[documentId]/share-links/route.ts`、`src/app/api/share-links/[linkId]/revoke/route.ts`
- Test: `tests/integration/share-link-api.test.ts`(call route handlers directly, following `phase3-workspace-admin-api.test.ts`)

**Interfaces:**

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| `POST` | `/api/documents/:documentId/share-links` | `{ label?: string; expiresInDays?: 1 \| 7 \| 30 \| 90 }` | `201 { link: ShareLinkView }` |
| `GET` | `/api/documents/:documentId/share-links` | — | `200 { links: ShareLinkView[] }` |
| `POST` | `/api/share-links/:linkId/revoke` | — | `204` |

Implement all three using existing `workspace-http.ts` wrappers (`establishTrustedCaller` + `toWorkspaceErrorResponse` + `Cache-Control: private, no-store`). Non-object JSON body → 400 `INVALID_REQUEST`.

- [ ] **Step 1: Write failing tests**: 201 returns `link.path` starting with `/s/`, body has no `url`; non-owner GET → 404; Team-document POST → 409 `SHARE_LINK_NOT_PERSONAL`; `expiresInDays: 2` → 400; revoke → 204, then GET shows `active: false`
- [ ] **Step 2–4:** Fail → implement → pass（`npm run test:integration`）
- [ ] **Step 5: Commit**

```bash
git commit -am "feat(api): create, list and revoke share links"
```

---

### Task 8: Public Reading Page `/s/:token`

**Files:**
- Create: `src/server/share-read.ts`、`src/app/s/[token]/page.tsx`、`src/app/s/[token]/not-found.tsx`
- Modify: `next.config.ts`
- Test: E2E in Task 11; verify this task with `npm run build`

**Interfaces:**
- `getSharedDocument(token: string): Promise<SharedDocumentView | null>`: call `shareReadService().readShared(token)`; return `null` on any error
- `page.tsx`: `export const dynamic = "force-dynamic"`; `null` → `notFound()`; `generateMetadata` returns only `{ title }` and `robots: { index: false, follow: false }`, without `openGraph`/`twitter`
- Content: title, `MarkdownRenderer`, one line “Shared by <sharedByName> · Last updated <Timestamp> · Link expires <Timestamp>”; no app shell and no links into the Hub
- `not-found.tsx`: copy from spec §6.3

Append an entry to `headers()` in `next.config.ts` (retain existing `/:path*` CSP):

```typescript
{
  source: "/s/:path*",
  headers: [
    { key: "Referrer-Policy", value: "no-referrer" },
    { key: "Cache-Control", value: "private, no-store" },
    { key: "X-Robots-Tag", value: "noindex, nofollow" },
    { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  ],
},
```

> Neither `page.tsx` nor `share-read.ts` may import `applicationServices` or `establishTrustedCaller`. Task 11 E2E opens links on a server without an SSO session reader; either misuse produces a page 500.

- [ ] **Step 1: Implement**
- [ ] **Step 2:** `npm run build && npm run typecheck && npm run lint` clean
- [ ] **Step 3: Commit**

```bash
git commit -am "feat(app): public read-only page for shared documents"
```

---

### Task 9: Action registry

**Files:**
- Modify: `src/components/actions/action-registry.ts`、`action-icon.tsx`、`action-menu.tsx`
- Test: `tests/unit/action-registry.test.ts`

**Interfaces:**
- Add `"document.share"` to `ActionId`; `"share"` to `ActionIconName` (`Link` from `lucide-react`); `"document.open-share"` to `ActionCommand`
- Availability condition: `target && context.workspaceType === "PERSONAL" && confirmed && target.status === "ACTIVE" && target.revision === "CURRENT"`. **Do not check `target.ownership` or `can.canWrite`.**
- `surfaces: ["palette", "row"]`, before `document.favorite`
- `document.open-share` in `useActionRunner` → `window.dispatchEvent(new CustomEvent("kh:request-share", { detail: { documentId } }))`

- [ ] **Step 1: Write failing tests**(add to existing file)

```typescript
describe("document.share (share-link spec §10.1)", () => {
  const ids = (overrides: Partial<ActionContext>) => availableActions(context({ target: target(), ...overrides })).map((action) => action.id);

  it("is offered on an active, current document in My Space", () => {
    expect(ids({ workspaceType: "PERSONAL" })).toContain("document.share");
  });

  it("is offered on SOURCE_MANAGED content: ownership decides writing, not sharing", () => {
    expect(ids({ workspaceType: "PERSONAL", target: target({ ownership: "SOURCE_MANAGED" }) })).toContain("document.share");
  });

  it.each([
    ["a Team workspace", { workspaceType: "TEAM" }],
    ["an unconfirmed access check", { workspaceType: "PERSONAL", confirmed: false }],
    ["an archived document", { workspaceType: "PERSONAL", target: target({ status: "ARCHIVED" }) }],
    ["a historical revision", { workspaceType: "PERSONAL", target: target({ revision: "HISTORICAL" }) }],
  ] as const)("is not offered on %s", (_, overrides) => {
    expect(ids(overrides as Partial<ActionContext>)).not.toContain("document.share");
  });
});
```

- [ ] **Step 2–4:** Fail → implement → pass（`npm run test:unit -- tests/unit/action-registry.test.ts`）
- [ ] **Step 5: Commit**

```bash
git commit -am "feat(ui): register the share-link action"
```

---

### Task 10: Share Dialog

**Files:**
- Create: `src/components/knowledge/share-link-dialog.tsx`
- Modify: `src/components/knowledge/knowledge-layout.tsx`、`src/components/knowledge/document-header.tsx`(and the page/inspector that supply its props)

**Interfaces:**
- `ShareLinkDialogHost`: mount in `KnowledgeLayout`, listen for `kh:request-share`, and open `ShareLinkDialog` using `detail.documentId`
- `ShareLinkDialog({ documentId, open, onOpenChange })`: `GET` list on opening; form (label, expiry `Select` default 30) → `POST`; each link shows label, creation/expiry (`Timestamp`), view count, `[Copy]` (`navigator.clipboard.writeText(window.location.origin + link.path)`), `[Revoke]` (two-step inline confirmation); collapse revoked/expired links under “Unavailable”
- Explanatory copy matches spec §4 exactly
- Revocation success → existing toast, no undo; creation success shows no toast
- Document header: for PERSONAL, ACTIVE, CURRENT, obtain `document.share` from registry and display its button beside Edit; clicking dispatches the same event
- Implement Dialog with `@base-ui-components/react/dialog`, following `create-team-dialog.tsx` structure

- [ ] **Step 1: Implement**
- [ ] **Step 2:** `npm run typecheck && npm run lint && npm run test:unit` clean. Note: Tailwind names outside the contract (`text-sm`, `rounded-xl`, …) **do not report errors; they compile to nothing**, so review each against `frontend-design-language.md`; lint blocks only handwritten focus rings (use `kh-focus-ring`).
- [ ] **Step 3: Commit**

```bash
git commit -am "feat(ui): share-link dialog from the row menu, palette and document header"
```

---

### Task 11: E2E

**Files:**
- Create: `tests/e2e/share-link.spec.ts`

All origins share one e2e database. Owner actions use the local server (`E2E Knowledge User`'s My Space); **anonymous reads use `phase3UnconfiguredOrigin()`**, a `company-sso` server without a session reader where every `establishTrustedCaller` fails, proving `/s/` does not depend on login (spec §6.1 composition requirement).

- [ ] **Step 1: Write tests**

```typescript
// tests/e2e/share-link.spec.ts
import { expect, test } from "@playwright/test";
import { phase3UnconfiguredOrigin } from "./fixtures/phase3-identities";

test.describe("document share link (spec §13 E2E)", () => {
  test.skip(!process.env.KM_PHASE3_APP_ROOT, "Run npm run test:e2e to provision the no-sign-in origin.");

  test("owner shares, an anonymous reader sees live content, revoke ends it", async ({ page, playwright }) => {
    // 1. Owner: create a document in My Space, open the share dialog via right-click, create a link.
    //    Read the path from the dialog's copy target rather than the clipboard.
    // 2. Anonymous: a request context on the unconfigured origin loads /s/<token>.
    const anonymous = await playwright.request.newContext({ baseURL: phase3UnconfiguredOrigin() });
    //    expect 200, the title and the "shared by" line; expect no og: meta tags.
    //    expect headers: referrer-policy no-referrer, cache-control contains no-store,
    //    x-robots-tag noindex, content-security-policy contains frame-ancestors 'none'.
    // 3. Same origin, /w/<myspace>/knowledge → not 200 (sign-in still required elsewhere).
    // 4. Owner edits the document; anonymous reload shows the new text.
    // 5. Owner revokes with the two-step confirm; anonymous reload → 404 and the unified text.
    // 6. A malformed token and a random UUIDv4 both → 404 with the same text.
    await anonymous.dispose();
  });
});
```

The comments above are a step list; implement every step as actual assertions.

- [ ] **Step 2:** `npm run test:e2e -- tests/e2e/share-link.spec.ts` passes
- [ ] **Step 3:** `npm run test:e2e` full suite passes
- [ ] **Step 4: Commit**

```bash
git add tests/e2e/share-link.spec.ts
git commit -m "test(e2e): share link from owner to an anonymous reader"
```

---

### Task 12: Contract Documents and Verification Record

**Files:**
- Modify: `CLAUDE.md`、`docs/superpowers/specs/2026-09-14-phase-3-identity-workspace-governance-design.md`、`README.md`
- Create: `docs/superpowers/verification/2026-09-23-document-share-link.md`

- [ ] **Step 1:** Replace “Knowing an ID is not authorization” in `CLAUDE.md` with spec §3.2 copy
- [ ] **Step 2:** Add the spec §3.3 exception paragraph under Phase 3 spec §13
- [ ] **Step 3:** Add this spec and plan to the `README.md` canonical documents table
- [ ] **Step 4:** Verification record: actual output summaries for tests at every layer, plus spec §15 rollout checklist (unchecked for completion during deployment)
- [ ] **Step 5:** `make verify` all green
- [ ] **Step 6: Commit**

```bash
git commit -am "docs: record the share-link exception in CLAUDE.md and Phase 3"
```

---

## Self-Review

| Spec item | Task |
| --- | --- |
| §3 Contract Changes | 12 |
| §5.1 Creation Conditions; Ownership Is Not a Condition | 2、4、9 |
| §5.2 Validity, Direct Role | 2、5 |
| §5.3 Current Revision | 5、11 |
| §5.4 Revocation, Two-Step Confirmation | 4、10、11 |
| §6.1 Single Entry, Composition Requirement | 5、6、8、11 |
| §6.2 No Propagation | 6(scan)、11(`/w/` still requires login) |
| §6.3 Uniform Unavailable Page | 8、11 |
| §6.4 Response Headers | 8、11 |
| §7 Data Model, No Stored Scope, Anonymous Counts | 1、3 |
| §8 UUIDv4, Nonsequential | 2、3、4 |
| §9.3 Lock Order | 4 |
| §9.4 Return Path | 7 |
| §10 UI | 9、10 |
| §13 Completion Criteria | 2、4、5、6、9、11 |
| §15 Coordinated Document Changes, Rollout Checklist | 12 |

**The first two §6.2 rules (search and selector never show the sharer's My Space)** have no separate tests: sharing links writes no membership or capability, so existing Phase 3/Phase 4 authorization tests cover these rules; Task 6 scans guarantee no second read path bypassing caller. If requested by review, add a Task 11 search assertion using a phase3 persona.

# Phase 5 Human Authoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users create, upload, and edit HUB_MANAGED documents on the Web, preserving changes as immutable Revisions and showing explicit conflicts during concurrent editing.

**Architecture:** Phase 1 already provides the complete write domain (`createDocument`/`createRevision`, the `document.write` capability gate, HUB_MANAGED guard, and `expectedCurrentRevisionId` conflict check). This Phase adds only lazy provisioning of the default Hub Source, two HTTP routes, and an editing page. No new schema, migrations, ports, or domain rules.

**Tech Stack:** Next.js 15 App Router、React 19、TypeScript、Tailwind、MariaDB 10.11、vitest 2、Playwright 1.55。

**Spec:** `docs/superpowers/specs/2026-09-16-phase-5-human-authoring-design.md`

Chinese text in code examples and quoted UI strings is preserved as literal test input or interface examples.

## Global Constraints

- All writes must pass through `lockWorkspaceForMutation(repositories, caller, workspaceId, "content-write")`, which requires the `document.write` capability.
- No ID in a route or body is authorization proof; the caller must come only from `services.establishTrustedCaller()`.
- `metadata` is not editable; always reuse the existing value or `{}`.
- Limits: `title` 512 characters, `markdown` 5 MiB (5 \* 1024 \* 1024 bytes, matching the default `KM_IMPORT_MAX_MARKDOWN_FILE_BYTES`).
- The default Hub Source name is fixed as `Notes`.
- New UI uses existing `kh-*` tokens; introduce no dependencies (the editor uses existing `ui/input.tsx` and `ui/textarea.tsx`).
- **Test commands**: unit can target one file (`npm run test:unit -- <path>`); **integration cannot target one file** because `runVitest()` in `scripts/test/integration.ts:9` hardcodes arguments and does not forward `process.argv`; run the entire suite with `npm run test:integration`; e2e can target one file (`scripts/test/e2e.ts:117` forwards arguments).
- `npm run typecheck && npm run lint` must be clean before finishing every task.

---

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `src/server/http-error-response.ts`(modify) | Add status-code mapping for Phase 5 error codes | 1 |
| `src/server/authoring-input.ts`(new) | Pure functions: parse and validate creation/editing request bodies | 2 |
| `src/modules/sources/application/ensure-default-hub-source.ts`(new) | Lazy provisioning of the default `Notes` Source | 3 |
| `src/app/api/workspaces/[workspaceId]/documents/route.ts`(new) | `POST` creation/upload | 4 |
| `src/app/api/documents/[documentId]/route.ts`(new) | `PATCH` creates a new Revision | 5 |
| `src/server/workspace-admin.ts`(modify) | `WorkspaceActions.canWrite` | 6 |
| `src/components/knowledge/document-editor.tsx`(new) | Editing form client component | 6 |
| `src/app/w/[workspaceId]/knowledge/[sourceId]/[documentId]/edit/page.tsx`(new) | Editing page | 6 |
| `src/components/knowledge/document-header.tsx`(modify) | Edit button and ownership-aware badge | 7 |
| `src/components/knowledge/document-inspector.tsx`(modify) | Pass ownership/canWrite to header | 7 |
| `src/app/w/[workspaceId]/knowledge/[sourceId]/[documentId]/page.tsx`(modify) | Pass ownership | 7 |
| `src/components/knowledge/knowledge-empty-state.tsx`(modify) | Creation entry for empty Workspaces | 8 |
| `src/components/knowledge/new-document-form.tsx`(new) | Creation/upload form | 8 |
| `src/components/knowledge/source-sidebar.tsx`(modify) | Persistent creation entry | 8 |
| `scripts/db/seed.ts`(modify) | Workspace fixture without a Hub Source | 9 |
| `tests/e2e/phase5-authoring.spec.ts`(new) | E2E | 9 |

---

### Task 1: Error Code Mapping

Without this step, stale-editor conflicts return 500 rather than 409: every unlisted `DomainError` falls through to 500 in `toWorkspaceErrorResponse`.

**Files:**
- Modify: `src/server/http-error-response.ts:61-70`
- Test: `tests/unit/phase5-error-mapping.test.ts`

**Interfaces:**
- Consumes: Existing `toWorkspaceErrorResponse(error: unknown): { status: number; body: ApiErrorBody }`
- Produces: The same function, adding mappings for `REVISION_CONFLICT`/`SOURCE_MANAGED_READ_ONLY`/`SOURCE_ARCHIVED`/`DOCUMENT_ARCHIVED` → 409, `INVALID_TITLE`/`INVALID_METADATA` → 400, `DOCUMENT_NOT_FOUND`/`SOURCE_NOT_FOUND` → 404

- [ ] **Step 1: Write failing tests**

```typescript
// tests/unit/phase5-error-mapping.test.ts
import { describe, expect, it } from "vitest";
import {
  DocumentArchivedError,
  DocumentNotFoundError,
  InvalidTitleError,
  RevisionConflictError,
  SourceArchivedError,
  SourceNotFoundError,
  SourceReadOnlyError,
} from "@/modules/knowledge/domain/errors";
import { toWorkspaceErrorResponse } from "@/server/http-error-response";

describe("Phase 5 authoring error mapping (spec §7.2)", () => {
  it("maps a stale-editor conflict to 409, never 500", () => {
    const mapped = toWorkspaceErrorResponse(new RevisionConflictError());
    expect(mapped.status).toBe(409);
    expect(mapped.body.error.code).toBe("REVISION_CONFLICT");
  });

  it("maps a write against SOURCE_MANAGED content to 409", () => {
    expect(toWorkspaceErrorResponse(new SourceReadOnlyError()).status).toBe(409);
  });

  it("maps archived source and document to 409", () => {
    expect(toWorkspaceErrorResponse(new SourceArchivedError()).status).toBe(409);
    expect(toWorkspaceErrorResponse(new DocumentArchivedError()).status).toBe(409);
  });

  it("maps candidate validation failures to 400", () => {
    const mapped = toWorkspaceErrorResponse(new InvalidTitleError());
    expect(mapped.status).toBe(400);
    expect(mapped.body.error.code).toBe("INVALID_TITLE");
  });

  it("maps missing document and source to a non-enumerating 404", () => {
    const mapped = toWorkspaceErrorResponse(new DocumentNotFoundError());
    expect(mapped.status).toBe(404);
    expect(mapped.body.error.code).toBe("NOT_FOUND");
    expect(toWorkspaceErrorResponse(new SourceNotFoundError()).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `npm run test:unit -- tests/unit/phase5-error-mapping.test.ts`
Expected: FAIL — currently all return 500.

- [ ] **Step 3: Implement**

In `src/server/http-error-response.ts`, add `DOCUMENT_NOT_FOUND` and `SOURCE_NOT_FOUND` to existing `HIDDEN_NOT_FOUND`:

```typescript
const HIDDEN_NOT_FOUND = new Set([
  "IMPORT_SNAPSHOT_NOT_FOUND",
  "IMPORT_SOURCE_NOT_FOUND",
  "WORKSPACE_ACCESS_DENIED",
  "WORKSPACE_NOT_FOUND",
  "DOCUMENT_NOT_FOUND",
  "SOURCE_NOT_FOUND",
]);
```

Add the Phase 5 codes to the two lists in `toWorkspaceErrorResponse`:

```typescript
    const status = ["INSUFFICIENT_WORKSPACE_CAPABILITY", "TEAM_CREATION_DENIED", "PERSONAL_WORKSPACE_FROZEN"].includes(error.code) ? 403
      : ["WORKSPACE_ARCHIVED", "LAST_DIRECT_OWNER", "MEMBER_ALREADY_EXISTS", "GROUP_MAPPING_ALREADY_EXISTS", "WORKSPACE_LIFECYCLE_VIOLATION",
         "REVISION_CONFLICT", "SOURCE_MANAGED_READ_ONLY", "SOURCE_ARCHIVED", "DOCUMENT_ARCHIVED"].includes(error.code) ? 409
      : ["MEMBER_NOT_FOUND", "INVALID_ROLE_ASSIGNMENT", "INVALID_WORKSPACE_NAME", "INVALID_REQUEST",
         "INVALID_TITLE", "INVALID_METADATA", "VALIDATION_ERROR"].includes(error.code) ? 400 : 500;
```

- [ ] **Step 4: Run tests and confirm success**

Run: `npm run test:unit -- tests/unit/phase5-error-mapping.test.ts`
Expected: PASS(5 cases)

- [ ] **Step 5: Confirm no regressions**

Run: `npm run test:unit && npm run typecheck && npm run lint`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add tests/unit/phase5-error-mapping.test.ts src/server/http-error-response.ts
git commit -m "fix: map Phase 5 authoring domain errors to real status codes"
```

---

### Task 2: Request Body Parsing (Pure Functions)

Extract body validation into pure functions so limits, mutual exclusion, and title resolution can be tested without DB access.

**Files:**
- Create: `src/server/authoring-input.ts`
- Test: `tests/unit/phase5-authoring-input.test.ts`

**Interfaces:**
- Consumes: `parseGenericMarkdownText`（`src/modules/sources/adapters/generic-markdown-folder-adapter.ts:86`）、`resolveImportTitle`（`src/modules/sources/domain/import-title.ts:6`）
- Produces:
  - `MAX_TITLE_LENGTH: 512`、`MAX_MARKDOWN_BYTES: 5242880`
  - `parseCreateDocumentInput(body: unknown): { title: string; markdown: string }`
  - `parseUpdateDocumentInput(body: unknown): { title: string; markdown: string; expectedCurrentRevisionId: string }`
  - Both throw `DomainError("INVALID_REQUEST", …)` on validation failure

- [ ] **Step 1: Write failing tests**

```typescript
// tests/unit/phase5-authoring-input.test.ts
import { describe, expect, it } from "vitest";
import { MAX_MARKDOWN_BYTES, MAX_TITLE_LENGTH, parseCreateDocumentInput, parseUpdateDocumentInput } from "@/server/authoring-input";

describe("parseCreateDocumentInput (spec §6.1, §6.2, §6.4)", () => {
  it("accepts an explicit title", () => {
    expect(parseCreateDocumentInput({ title: "Runbook", markdown: "# Hi" }))
      .toEqual({ title: "Runbook", markdown: "# Hi" });
  });

  it("resolves the title from frontmatter when a filename is given", () => {
    const markdown = "---\ntitle: 請假流程\n---\n\n# Something Else\n";
    expect(parseCreateDocumentInput({ filename: "leave.md", markdown }).title).toBe("請假流程");
  });

  it("falls back to the first H1, then to the filename stem", () => {
    expect(parseCreateDocumentInput({ filename: "leave.md", markdown: "# Leave Policy\n" }).title).toBe("Leave Policy");
    expect(parseCreateDocumentInput({ filename: "leave-policy.md", markdown: "no heading\n" }).title).toBe("leave-policy");
  });

  it("rejects giving both title and filename", () => {
    expect(() => parseCreateDocumentInput({ title: "A", filename: "a.md", markdown: "x" })).toThrow(/INVALID_REQUEST|exactly one/i);
  });

  it("rejects giving neither", () => {
    expect(() => parseCreateDocumentInput({ markdown: "x" })).toThrow();
  });

  it("rejects a non-object body and non-string fields", () => {
    expect(() => parseCreateDocumentInput(null)).toThrow();
    expect(() => parseCreateDocumentInput({ title: 5, markdown: "x" })).toThrow();
    expect(() => parseCreateDocumentInput({ title: "A", markdown: 5 })).toThrow();
  });

  it("rejects an over-long title and an over-large markdown body", () => {
    expect(() => parseCreateDocumentInput({ title: "x".repeat(MAX_TITLE_LENGTH + 1), markdown: "x" })).toThrow();
    expect(() => parseCreateDocumentInput({ title: "A", markdown: "x".repeat(MAX_MARKDOWN_BYTES + 1) })).toThrow();
  });

  it("rejects a blank title", () => {
    expect(() => parseCreateDocumentInput({ title: "   ", markdown: "x" })).toThrow();
  });
});

describe("parseUpdateDocumentInput (spec §6.1)", () => {
  it("requires all three fields", () => {
    expect(parseUpdateDocumentInput({ title: "A", markdown: "b", expectedCurrentRevisionId: "r1" }))
      .toEqual({ title: "A", markdown: "b", expectedCurrentRevisionId: "r1" });
    expect(() => parseUpdateDocumentInput({ title: "A", markdown: "b" })).toThrow();
  });
});
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `npm run test:unit -- tests/unit/phase5-authoring-input.test.ts`
Expected: FAIL — `Cannot find module '@/server/authoring-input'`

- [ ] **Step 3: Implement**

```typescript
// src/server/authoring-input.ts
import { parseGenericMarkdownText } from "@/modules/sources/adapters/generic-markdown-folder-adapter";
import { resolveImportTitle } from "@/modules/sources/domain/import-title";
import { DomainError } from "@/shared/domain/errors";

export const MAX_TITLE_LENGTH = 512;
export const MAX_MARKDOWN_BYTES = 5 * 1024 * 1024;

function invalid(message: string): never {
  throw new DomainError("INVALID_REQUEST", message);
}

function readObject(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) invalid("Provide a JSON object.");
  return body as Record<string, unknown>;
}

function readString(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== "string") invalid(`Provide ${field} as a string.`);
  return value;
}

function readMarkdown(record: Record<string, unknown>): string {
  const markdown = readString(record, "markdown");
  if (Buffer.byteLength(markdown, "utf8") > MAX_MARKDOWN_BYTES) invalid("Markdown is too large.");
  return markdown;
}

function checkedTitle(raw: string): string {
  const title = raw.trim();
  if (!title) invalid("Provide a non-empty title.");
  if (title.length > MAX_TITLE_LENGTH) invalid("Title is too long.");
  return title;
}

export function parseCreateDocumentInput(body: unknown): { title: string; markdown: string } {
  const record = readObject(body);
  const hasTitle = record.title !== undefined;
  const hasFilename = record.filename !== undefined;
  if (hasTitle === hasFilename) invalid("Provide exactly one of title or filename.");
  const markdown = readMarkdown(record);
  if (hasTitle) return { title: checkedTitle(readString(record, "title")), markdown };

  // Upload path: the same frontmatter → H1 → filename precedence folder import uses.
  const filename = readString(record, "filename");
  const parsed = parseGenericMarkdownText({ sourcePath: filename, markdown });
  const resolved = resolveImportTitle({
    sourcePath: filename,
    frontmatterTitle: parsed.frontmatterTitle,
    firstH1: parsed.firstH1,
  });
  return { title: checkedTitle(resolved.title), markdown };
}

export function parseUpdateDocumentInput(body: unknown): {
  title: string;
  markdown: string;
  expectedCurrentRevisionId: string;
} {
  const record = readObject(body);
  return {
    title: checkedTitle(readString(record, "title")),
    markdown: readMarkdown(record),
    expectedCurrentRevisionId: readString(record, "expectedCurrentRevisionId"),
  };
}
```

- [ ] **Step 4: Run tests and confirm success**

Run: `npm run test:unit -- tests/unit/phase5-authoring-input.test.ts`
Expected: PASS。

If mismatched return field names from `parseGenericMarkdownText` cause failure, first run `grep -n "return" -B 12 src/modules/sources/adapters/generic-markdown-folder-adapter.ts` to confirm actual names, and adjust `parsed.frontmatterTitle` / `parsed.firstH1` above accordingly. **Do not** change expected test titles.

- [ ] **Step 5: Commit**

```bash
git add tests/unit/phase5-authoring-input.test.ts src/server/authoring-input.ts
git commit -m "feat: parse and validate authoring request bodies"
```

---

### Task 3: Default Hub Source Lazy Provisioning

**Files:**
- Create: `src/modules/sources/application/ensure-default-hub-source.ts`
- Test: `tests/integration/phase5-default-hub-source.test.ts`

**Interfaces:**
- Consumes: `SourceUnitOfWork`（`src/modules/sources/ports/unit-of-work.ts:31`）、`lockWorkspaceForMutation`、`uuidv7`
- Produces: `DEFAULT_HUB_SOURCE_NAME = "Notes"`、`ensureDefaultHubSource(unitOfWork: SourceUnitOfWork, caller: CallerContext, workspaceId: string): Promise<string>`(returns sourceId)

- [ ] **Step 1: Write failing tests**

```typescript
// tests/integration/phase5-default-hub-source.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import type { UserIdentity } from "@/modules/identity/domain/user-identity";
import { DEFAULT_HUB_SOURCE_NAME, ensureDefaultHubSource } from "@/modules/sources/application/ensure-default-hub-source";
import { WorkspaceAccessDeniedError } from "@/modules/workspaces/domain/errors";
import { createTeamWorkspaceInsert } from "@/modules/workspaces/domain/workspace";
import { createDirectMembership } from "@/modules/workspaces/domain/workspace-membership";
import { uuidv7 } from "@/shared/ids/uuidv7";

let pool: Pool;
beforeAll(() => { pool = createDatabasePool(databaseConfig("test")); });
afterAll(async () => { await pool.end(); });

const owner: UserIdentity = { id: "00000000-0000-0000-0000-000000000511", emp_id: "P5-OWNER", name: "Owner", org_code: "HRSD" };
const viewer: UserIdentity = { id: "00000000-0000-0000-0000-000000000512", emp_id: "P5-VIEWER", name: "Viewer", org_code: "HRSD" };

async function createWorkspace(): Promise<string> {
  const unitOfWork = new MariaDbUnitOfWork(pool);
  const workspaceId = uuidv7();
  const now = new Date();
  await unitOfWork.run(async (repositories) => {
    for (const identity of [owner, viewer]) await repositories.users.upsertIdentity(identity);
    await repositories.workspaces.insert(createTeamWorkspaceInsert({ id: workspaceId, name: `WS ${workspaceId}`, createdBy: owner.id, now }));
    await repositories.workspaceMemberships.insert(createDirectMembership({ workspaceId, userId: owner.id, role: "OWNER", createdBy: owner.id, now }));
    await repositories.workspaceMemberships.insert(createDirectMembership({ workspaceId, userId: viewer.id, role: "VIEWER", createdBy: owner.id, now }));
  });
  return workspaceId;
}

describe("ensureDefaultHubSource (spec §5)", () => {
  it("creates a Notes source on first use", async () => {
    const workspaceId = await createWorkspace();
    const unitOfWork = new MariaDbUnitOfWork(pool);
    const sourceId = await ensureDefaultHubSource(unitOfWork, callerFromIdentity(owner), workspaceId);
    const sources = await unitOfWork.run((repositories) => repositories.sourcePolicy.listByWorkspaceId(workspaceId));
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ id: sourceId, name: DEFAULT_HUB_SOURCE_NAME, sourceType: "HUB", ownership: "HUB_MANAGED", status: "ACTIVE" });
  });

  it("is idempotent: a second call reuses the same source", async () => {
    const workspaceId = await createWorkspace();
    const unitOfWork = new MariaDbUnitOfWork(pool);
    const caller = callerFromIdentity(owner);
    const first = await ensureDefaultHubSource(unitOfWork, caller, workspaceId);
    const second = await ensureDefaultHubSource(unitOfWork, caller, workspaceId);
    expect(second).toBe(first);
    const sources = await unitOfWork.run((repositories) => repositories.sourcePolicy.listByWorkspaceId(workspaceId));
    expect(sources).toHaveLength(1);
  });

  it("creates exactly one source under concurrent first writes", async () => {
    const workspaceId = await createWorkspace();
    const caller = callerFromIdentity(owner);
    const results = await Promise.all([
      ensureDefaultHubSource(new MariaDbUnitOfWork(pool), caller, workspaceId),
      ensureDefaultHubSource(new MariaDbUnitOfWork(pool), caller, workspaceId),
    ]);
    expect(results[0]).toBe(results[1]);
    const sources = await new MariaDbUnitOfWork(pool).run((repositories) => repositories.sourcePolicy.listByWorkspaceId(workspaceId));
    expect(sources).toHaveLength(1);
  });

  it("refuses a caller without document.write", async () => {
    const workspaceId = await createWorkspace();
    await expect(ensureDefaultHubSource(new MariaDbUnitOfWork(pool), callerFromIdentity(viewer), workspaceId))
      .rejects.toBeInstanceOf(WorkspaceAccessDeniedError);
  });
});
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `npm run test:integration`
Expected: FAIL — `Cannot find module '@/modules/sources/application/ensure-default-hub-source'`. (Integration tests cannot run one file; see Global Constraints.)

- [ ] **Step 3: Implement**

```typescript
// src/modules/sources/application/ensure-default-hub-source.ts
import type { CallerContext } from "@/modules/identity/domain/caller-context";
import { lockWorkspaceForMutation } from "@/modules/workspaces/application/workspace-mutation-guard";
import { uuidv7 } from "@/shared/ids/uuidv7";
import type { SourceUnitOfWork } from "../ports/unit-of-work";

export const DEFAULT_HUB_SOURCE_NAME = "Notes";

/**
 * Spec §5: every Workspace gets one lazily-created Hub Source so that authoring
 * has somewhere to put a first document.
 *
 * Runs in its own transaction on purpose (spec §5.2). The global lock order is
 * Source → Workspace, but there is no Source to lock yet, so this path takes the
 * Workspace lock alone and never holds both — no deadlock cycle with the four
 * existing Hub writers. Concurrent first writes serialize on that Workspace row:
 * the loser re-reads and reuses the winner's Source.
 *
 * Authorized as "content-write" (document.write), not "source-import": the user
 * action is authoring, and Source creation is only incidental (spec §5.4).
 */
export async function ensureDefaultHubSource(
  unitOfWork: SourceUnitOfWork,
  caller: CallerContext,
  workspaceId: string,
): Promise<string> {
  return unitOfWork.run(async (repositories) => {
    await repositories.users.upsertIdentity(caller.identity);
    await lockWorkspaceForMutation(repositories, caller, workspaceId, "content-write");
    const existing = (await repositories.sourcePolicy.listByWorkspaceId(workspaceId))
      .find((source) => source.sourceType === "HUB" && source.status === "ACTIVE" && source.name === DEFAULT_HUB_SOURCE_NAME);
    if (existing) return existing.id;
    const now = new Date();
    const id = uuidv7();
    await repositories.sources.insert({
      id, name: DEFAULT_HUB_SOURCE_NAME, workspaceId, sourceType: "HUB", ownership: "HUB_MANAGED",
      status: "ACTIVE", syncVersion: 0, createdBy: caller.identity.id, updatedBy: caller.identity.id,
      archivedBy: null, archivedAt: null, createdAt: now, updatedAt: now,
    });
    return id;
  });
}
```

- [ ] **Step 4: Run tests and confirm success**

Run: `npm run test:integration`
Expected: PASS — 4 new cases, with no regressions in existing cases.

- [ ] **Step 5: Commit**

```bash
git add tests/integration/phase5-default-hub-source.test.ts src/modules/sources/application/ensure-default-hub-source.ts
git commit -m "feat: lazily provision the default Notes hub source"
```

---

### Task 4: Creation and Upload Routes

**Files:**
- Create: `src/app/api/workspaces/[workspaceId]/documents/route.ts`
- Test: `tests/integration/phase5-authoring-service.test.ts`

**Interfaces:**
- Consumes: Task 2 `parseCreateDocumentInput`, Task 3 `ensureDefaultHubSource`, existing `workspaceHttp`, `services.hub.createDocument`
- Produces: `POST` returns `{ documentId, sourceId, revisionId }`

This task's integration tests directly test the service composition (`ensureDefaultHubSource` + `createDocument`) without HTTP; the route is thin wiring covered by Task 9 E2E.

- [ ] **Step 1: Write failing tests**

```typescript
// tests/integration/phase5-authoring-service.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import type { UserIdentity } from "@/modules/identity/domain/user-identity";
import { HubKnowledgeCommandServiceImpl } from "@/modules/knowledge/application/hub-knowledge-command-service";
import { KnowledgeQueryServiceImpl } from "@/modules/knowledge/application/knowledge-query-service";
import { RevisionConflictError, SourceReadOnlyError } from "@/modules/knowledge/domain/errors";
import { ensureDefaultHubSource } from "@/modules/sources/application/ensure-default-hub-source";
import { WorkspaceAccessDeniedError } from "@/modules/workspaces/domain/errors";
import { createTeamWorkspaceInsert } from "@/modules/workspaces/domain/workspace";
import { createDirectMembership } from "@/modules/workspaces/domain/workspace-membership";
import { uuidv7 } from "@/shared/ids/uuidv7";

let pool: Pool;
beforeAll(() => { pool = createDatabasePool(databaseConfig("test")); });
afterAll(async () => { await pool.end(); });

const owner: UserIdentity = { id: "00000000-0000-0000-0000-000000000521", emp_id: "P5-A-OWNER", name: "Owner", org_code: "HRSD" };
const viewer: UserIdentity = { id: "00000000-0000-0000-0000-000000000522", emp_id: "P5-A-VIEWER", name: "Viewer", org_code: "HRSD" };

async function createWorkspace(): Promise<string> {
  const unitOfWork = new MariaDbUnitOfWork(pool);
  const workspaceId = uuidv7();
  const now = new Date();
  await unitOfWork.run(async (repositories) => {
    for (const identity of [owner, viewer]) await repositories.users.upsertIdentity(identity);
    await repositories.workspaces.insert(createTeamWorkspaceInsert({ id: workspaceId, name: `WS ${workspaceId}`, createdBy: owner.id, now }));
    await repositories.workspaceMemberships.insert(createDirectMembership({ workspaceId, userId: owner.id, role: "OWNER", createdBy: owner.id, now }));
    await repositories.workspaceMemberships.insert(createDirectMembership({ workspaceId, userId: viewer.id, role: "VIEWER", createdBy: owner.id, now }));
  });
  return workspaceId;
}

describe("Phase 5 authoring (spec §4, §7.1)", () => {
  it("creates revision 1 in the lazily provisioned source", async () => {
    const workspaceId = await createWorkspace();
    const unitOfWork = new MariaDbUnitOfWork(pool);
    const caller = callerFromIdentity(owner);
    const sourceId = await ensureDefaultHubSource(unitOfWork, caller, workspaceId);
    const created = await new HubKnowledgeCommandServiceImpl(unitOfWork).createDocument(caller, {
      sourceId, parentId: null, title: "Runbook", markdown: "first", metadata: {},
    });
    const revisions = await new KnowledgeQueryServiceImpl(unitOfWork).listRevisions(caller, created.documentId);
    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toMatchObject({ revisionNo: 1, title: "Runbook", markdown: "first" });
  });

  it("creates revision 2 on edit and leaves revision 1 untouched", async () => {
    const workspaceId = await createWorkspace();
    const unitOfWork = new MariaDbUnitOfWork(pool);
    const caller = callerFromIdentity(owner);
    const hub = new HubKnowledgeCommandServiceImpl(unitOfWork);
    const sourceId = await ensureDefaultHubSource(unitOfWork, caller, workspaceId);
    const created = await hub.createDocument(caller, { sourceId, parentId: null, title: "Runbook", markdown: "v1", metadata: {} });
    await hub.createRevision(caller, {
      documentId: created.documentId, expectedCurrentRevisionId: created.revisionId,
      title: "Runbook", markdown: "v2", metadata: {},
    });
    const revisions = await new KnowledgeQueryServiceImpl(unitOfWork).listRevisions(caller, created.documentId);
    expect(revisions.map((revision) => revision.markdown).sort()).toEqual(["v1", "v2"]);
  });

  it("does not create a revision when the content is unchanged", async () => {
    const workspaceId = await createWorkspace();
    const unitOfWork = new MariaDbUnitOfWork(pool);
    const caller = callerFromIdentity(owner);
    const hub = new HubKnowledgeCommandServiceImpl(unitOfWork);
    const sourceId = await ensureDefaultHubSource(unitOfWork, caller, workspaceId);
    const created = await hub.createDocument(caller, { sourceId, parentId: null, title: "Same", markdown: "same", metadata: {} });
    const result = await hub.createRevision(caller, {
      documentId: created.documentId, expectedCurrentRevisionId: created.revisionId,
      title: "Same", markdown: "same", metadata: {},
    });
    expect(result.changed).toBe(false);
    const revisions = await new KnowledgeQueryServiceImpl(unitOfWork).listRevisions(caller, created.documentId);
    expect(revisions).toHaveLength(1);
  });

  it("rejects a stale editor and keeps the winner's content", async () => {
    const workspaceId = await createWorkspace();
    const unitOfWork = new MariaDbUnitOfWork(pool);
    const caller = callerFromIdentity(owner);
    const hub = new HubKnowledgeCommandServiceImpl(unitOfWork);
    const queries = new KnowledgeQueryServiceImpl(unitOfWork);
    const sourceId = await ensureDefaultHubSource(unitOfWork, caller, workspaceId);
    const created = await hub.createDocument(caller, { sourceId, parentId: null, title: "Doc", markdown: "v1", metadata: {} });
    const stale = created.revisionId;
    await hub.createRevision(caller, { documentId: created.documentId, expectedCurrentRevisionId: stale, title: "Doc", markdown: "winner", metadata: {} });
    await expect(hub.createRevision(caller, {
      documentId: created.documentId, expectedCurrentRevisionId: stale, title: "Doc", markdown: "loser", metadata: {},
    })).rejects.toBeInstanceOf(RevisionConflictError);
    expect((await queries.getCurrentRevision(caller, created.documentId)).markdown).toBe("winner");
  });

  it("preserves existing metadata across an edit", async () => {
    const workspaceId = await createWorkspace();
    const unitOfWork = new MariaDbUnitOfWork(pool);
    const caller = callerFromIdentity(owner);
    const hub = new HubKnowledgeCommandServiceImpl(unitOfWork);
    const queries = new KnowledgeQueryServiceImpl(unitOfWork);
    const sourceId = await ensureDefaultHubSource(unitOfWork, caller, workspaceId);
    const created = await hub.createDocument(caller, { sourceId, parentId: null, title: "Doc", markdown: "v1", metadata: { owner: "hr", tags: ["a"] } });
    const current = await queries.getCurrentRevision(caller, created.documentId);
    await hub.createRevision(caller, {
      documentId: created.documentId, expectedCurrentRevisionId: current.id,
      title: "Doc", markdown: "v2", metadata: current.metadata as Record<string, never>,
    });
    expect((await queries.getCurrentRevision(caller, created.documentId)).metadata).toEqual({ owner: "hr", tags: ["a"] });
  });

  it("refuses a VIEWER on both create and edit", async () => {
    const workspaceId = await createWorkspace();
    const unitOfWork = new MariaDbUnitOfWork(pool);
    const hub = new HubKnowledgeCommandServiceImpl(unitOfWork);
    const sourceId = await ensureDefaultHubSource(unitOfWork, callerFromIdentity(owner), workspaceId);
    const created = await hub.createDocument(callerFromIdentity(owner), { sourceId, parentId: null, title: "Doc", markdown: "v1", metadata: {} });
    await expect(hub.createDocument(callerFromIdentity(viewer), { sourceId, parentId: null, title: "Nope", markdown: "x", metadata: {} }))
      .rejects.toBeInstanceOf(WorkspaceAccessDeniedError);
    await expect(hub.createRevision(callerFromIdentity(viewer), {
      documentId: created.documentId, expectedCurrentRevisionId: created.revisionId, title: "Doc", markdown: "x", metadata: {},
    })).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);
  });

  it("refuses edits to SOURCE_MANAGED content", async () => {
    const workspaceId = await createWorkspace();
    const unitOfWork = new MariaDbUnitOfWork(pool);
    const caller = callerFromIdentity(owner);
    const hub = new HubKnowledgeCommandServiceImpl(unitOfWork);
    const hubSourceId = await ensureDefaultHubSource(unitOfWork, caller, workspaceId);
    const created = await hub.createDocument(caller, { sourceId: hubSourceId, parentId: null, title: "Doc", markdown: "v1", metadata: {} });
    // Flip the owning source to SOURCE_MANAGED to simulate folder-synced content.
    await unitOfWork.run(async (repositories) => {
      await repositories.sources.insert({
        id: uuidv7(), name: "unused", workspaceId, sourceType: "FOLDER_SYNC", ownership: "SOURCE_MANAGED",
        status: "ACTIVE", syncVersion: 0, createdBy: owner.id, updatedBy: owner.id,
        archivedBy: null, archivedAt: null, createdAt: new Date(), updatedAt: new Date(),
      });
      await repositories.connection?.query?.(
        "UPDATE knowledge_sources SET source_type = 'FOLDER_SYNC', ownership = 'SOURCE_MANAGED' WHERE id = ?",
        [hubSourceId],
      );
    });
    await expect(hub.createRevision(caller, {
      documentId: created.documentId, expectedCurrentRevisionId: created.revisionId, title: "Doc", markdown: "v2", metadata: {},
    })).rejects.toBeInstanceOf(SourceReadOnlyError);
  });
});
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `npm run test:integration`
Expected: FAIL。

The last case uses the possibly nonexistent escape hatch `repositories.connection?.query?.`. If that field does not exist and prevents execution, use the existing seed fixture pattern for a SOURCE_MANAGED source: create a source with `repositories.sources.insert`, `sourceType: "FOLDER_SYNC"` / `ownership: "SOURCE_MANAGED"`, then directly create a document under it with `repositories.documents.insertDraft` + `repositories.revisions.insert` + `repositories.tree.insert` (copy all three field patterns from `scripts/db/seed.ts:92-107`), then call `createRevision`. **Do not** delete this case.

- [ ] **Step 3: Implement routes**

```typescript
// src/app/api/workspaces/[workspaceId]/documents/route.ts
import { parseCreateDocumentInput } from "@/server/authoring-input";
import { ensureDefaultHubSource } from "@/modules/sources/application/ensure-default-hub-source";
import { workspaceHttp, type WorkspaceRouteContext } from "@/server/workspace-http";

export async function POST(request: Request, context: WorkspaceRouteContext) {
  return workspaceHttp(async (services, caller) => {
    const { workspaceId } = await context.params;
    const input = parseCreateDocumentInput(await request.json().catch(() => null));
    const sourceId = await ensureDefaultHubSource(services.unitOfWork, caller, workspaceId);
    const created = await services.hub.createDocument(caller, {
      sourceId, parentId: null, title: input.title, markdown: input.markdown, metadata: {},
    });
    return { documentId: created.documentId, sourceId, revisionId: created.revisionId };
  }, 201);
}
```

- [ ] **Step 4: Run tests and confirm success**

Run: `npm run test:integration && npm run typecheck && npm run lint`
Expected: all exit 0.

- [ ] **Step 5: Commit**

```bash
git add tests/integration/phase5-authoring-service.test.ts "src/app/api/workspaces/[workspaceId]/documents/route.ts"
git commit -m "feat: add the document create and upload route"
```

---

### Task 5: Editing Route

**Files:**
- Create: `src/app/api/documents/[documentId]/route.ts`
- Test: `tests/unit/phase5-update-route.test.ts`

**Interfaces:**
- Consumes: Task 2 `parseUpdateDocumentInput`, `services.queries.getCurrentRevision`, `services.hub.createRevision`
- Produces: `PATCH` returns `{ revisionId, revisionNo, changed }`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/unit/phase5-update-route.test.ts
import { describe, expect, it, vi } from "vitest";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import type { applicationServices as ApplicationServicesFn } from "@/server/composition";

vi.mock("@/server/composition", () => ({ applicationServices: vi.fn() }));

import { applicationServices } from "@/server/composition";
import { PATCH } from "@/app/api/documents/[documentId]/route";

type Services = ReturnType<typeof ApplicationServicesFn>;

const caller = callerFromIdentity({ id: "0199f500-0000-7000-8000-0000000005b1", emp_id: "P5-R", name: "R", org_code: "HRSD" });
const DOCUMENT_ID = "0199f500-0000-7000-8000-0000000005b2";

function request(body: unknown): Request {
  return new Request("http://127.0.0.1/api/documents/x", { method: "PATCH", body: JSON.stringify(body) });
}

function fakeServices(createRevision: ReturnType<typeof vi.fn>, metadata: Record<string, unknown> = { keep: "me" }): Services {
  return {
    establishTrustedCaller: vi.fn(async () => ({ caller })),
    queries: { getCurrentRevision: vi.fn(async () => ({ id: "rev-1", metadata })) },
    hub: { createRevision },
  } as unknown as Services;
}

const context = { params: Promise.resolve({ workspaceId: "", documentId: DOCUMENT_ID }) };

describe("PATCH /api/documents/[documentId] (spec §6.1, §6.3)", () => {
  it("passes the caller's title and markdown through to createRevision", async () => {
    const createRevision = vi.fn(async () => ({ revisionId: "rev-2", revisionNo: 2, changed: true }));
    vi.mocked(applicationServices).mockReturnValue(fakeServices(createRevision));

    const response = await PATCH(request({ title: "T", markdown: "M", expectedCurrentRevisionId: "rev-1" }), context);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ revisionId: "rev-2", revisionNo: 2, changed: true });
    expect(createRevision).toHaveBeenCalledWith(caller, expect.objectContaining({
      documentId: DOCUMENT_ID, expectedCurrentRevisionId: "rev-1", title: "T", markdown: "M",
    }));
  });

  it("preserves the existing metadata instead of clearing it", async () => {
    const createRevision = vi.fn(async () => ({ revisionId: "rev-2", revisionNo: 2, changed: true }));
    vi.mocked(applicationServices).mockReturnValue(fakeServices(createRevision, { owner: "hr" }));

    await PATCH(request({ title: "T", markdown: "M", expectedCurrentRevisionId: "rev-1" }), context);

    expect(createRevision.mock.calls[0][1].metadata).toEqual({ owner: "hr" });
  });

  it("rejects a body missing expectedCurrentRevisionId with 400", async () => {
    vi.mocked(applicationServices).mockReturnValue(fakeServices(vi.fn()));
    const response = await PATCH(request({ title: "T", markdown: "M" }), context);
    expect(response.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `npm run test:unit -- tests/unit/phase5-update-route.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// src/app/api/documents/[documentId]/route.ts
import { parseUpdateDocumentInput } from "@/server/authoring-input";
import { workspaceHttp } from "@/server/workspace-http";

type DocumentRouteContext = { params: Promise<{ documentId: string }> };

export async function PATCH(request: Request, context: DocumentRouteContext) {
  return workspaceHttp(async (services, caller) => {
    const { documentId } = await context.params;
    const input = parseUpdateDocumentInput(await request.json().catch(() => null));
    // Spec §6.3: metadata is not editable, so carry the stored value forward
    // rather than clearing frontmatter the import brought in. Reading it outside
    // the write transaction is safe: if current has moved on, createRevision
    // rejects with REVISION_CONFLICT before any mismatched metadata is written.
    const current = await services.queries.getCurrentRevision(caller, documentId);
    return services.hub.createRevision(caller, {
      documentId,
      expectedCurrentRevisionId: input.expectedCurrentRevisionId,
      title: input.title,
      markdown: input.markdown,
      metadata: current.metadata,
    });
  });
}
```

- [ ] **Step 4: Run tests and confirm success**

Run: `npm run test:unit -- tests/unit/phase5-update-route.test.ts`
Expected: PASS(3 cases)。

If a type conflict between `WorkspaceRouteContext` and `DocumentRouteContext` fails typecheck, retain the locally declared `DocumentRouteContext` above; do not change the shared type in `workspace-http.ts`.

- [ ] **Step 5: Complete gate**

Run: `npm run test:unit && npm run typecheck && npm run lint`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add tests/unit/phase5-update-route.test.ts "src/app/api/documents/[documentId]/route.ts"
git commit -m "feat: add the document edit route preserving stored metadata"
```

---

### Task 6: canWrite Action and Editing page

**Files:**
- Modify: `src/server/workspace-admin.ts:10-16`、`:40-58`
- Create: `src/components/knowledge/document-editor.tsx`
- Create: `src/app/w/[workspaceId]/knowledge/[sourceId]/[documentId]/edit/page.tsx`
- Test: `tests/unit/phase5-can-write.test.ts`

**Interfaces:**
- Consumes: Existing `deriveWorkspaceActions(workspace, capabilities)`
- Produces: `WorkspaceActions.canWrite: boolean`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/unit/phase5-can-write.test.ts
import { describe, expect, it } from "vitest";
import { ROLE_WORKSPACE_CAPABILITIES, type WorkspaceCapability } from "@/modules/workspaces/domain/workspace-capability";
import { deriveWorkspaceActions } from "@/server/workspace-admin";
import type { Workspace } from "@/modules/workspaces/domain/workspace";

const team = {
  id: "0199f500-0000-7000-8000-0000000005c1",
  name: "Team",
  workspaceType: "TEAM",
  lifecycleState: "ACTIVE",
  personalOwnerUserId: null,
} as unknown as Workspace;

function actionsFor(role: "OWNER" | "EDITOR" | "VIEWER") {
  return deriveWorkspaceActions(team, new Set<WorkspaceCapability>(ROLE_WORKSPACE_CAPABILITIES[role]));
}

describe("canWrite derivation (spec §8.1)", () => {
  it("is true for roles holding document.write", () => {
    expect(actionsFor("EDITOR").canWrite).toBe(true);
    expect(actionsFor("OWNER").canWrite).toBe(true);
  });

  it("is false for VIEWER", () => {
    expect(actionsFor("VIEWER").canWrite).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `npm run test:unit -- tests/unit/phase5-can-write.test.ts`
Expected: FAIL — `canWrite` does not exist (a typecheck error).

- [ ] **Step 3: Add action**

In `WorkspaceActions` in `src/server/workspace-admin.ts`, add directly after `canSearch: boolean;`:

```typescript
  canWrite: boolean;
```

In the object returned by `deriveWorkspaceActions`, add directly after `canSearch: has("document.read"),`:

```typescript
    canWrite: has("document.write"),
```

- [ ] **Step 4: Run tests and confirm success**

Run: `npm run test:unit -- tests/unit/phase5-can-write.test.ts`
Expected: PASS。

- [ ] **Step 5: Write editor component**

```tsx
// src/components/knowledge/document-editor.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspaceAuthorization } from "@/components/shell/use-workspace-authorization";
import { GovernanceError, governanceFailure, governanceRequest, type GovernanceFailure } from "@/components/workspaces/governance-error";

export function DocumentEditor({
  workspaceId,
  sourceId,
  documentId,
  expectedCurrentRevisionId,
  initialTitle,
  initialMarkdown,
}: {
  workspaceId: string;
  sourceId: string;
  documentId: string;
  expectedCurrentRevisionId: string;
  initialTitle: string;
  initialMarkdown: string;
}) {
  const router = useRouter();
  const { confirmed } = useWorkspaceAuthorization();
  const [title, setTitle] = useState(initialTitle);
  const [markdown, setMarkdown] = useState(initialMarkdown);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<GovernanceFailure | null>(null);
  const documentHref = `/w/${workspaceId}/knowledge/${sourceId}/${documentId}`;

  async function save() {
    if (busy || !confirmed) return;
    setBusy(true);
    setError(null);
    try {
      await governanceRequest(`/api/documents/${documentId}`, "PATCH", { title, markdown, expectedCurrentRevisionId });
      router.push(documentHref);
      router.refresh();
    } catch (failure) {
      setError(governanceFailure(failure));
    } finally {
      setBusy(false);
    }
  }

  const conflict = error?.code === "REVISION_CONFLICT";

  return (
    <form
      className="mx-auto w-full max-w-[860px] space-y-4 px-6 py-6"
      onSubmit={(event) => { event.preventDefault(); void save(); }}
    >
      <label className="block text-sm text-kh-text">
        Title
        <Input className="mt-1" value={title} maxLength={512} required disabled={busy} onChange={(event) => setTitle(event.target.value)} />
      </label>
      <label className="block text-sm text-kh-text">
        Markdown
        <Textarea className="mt-1 min-h-[24rem]" value={markdown} disabled={busy} onChange={(event) => setMarkdown(event.target.value)} />
      </label>
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={busy || !confirmed || !title.trim()}>Save</Button>
        <Button type="button" className="bg-transparent text-kh-text hover:brightness-100" disabled={busy} onClick={() => router.push(documentHref)}>
          Cancel
        </Button>
      </div>
      {conflict ? (
        <p role="alert" className="rounded-md border border-kh-border bg-kh-bg-subtle px-3 py-2 text-sm text-kh-text">
          這份文件已被其他人更新。你的輸入仍保留在表單中。
          <a className="ml-2 font-medium text-kh-accent underline underline-offset-2" href={`${documentHref}/edit`}>重新載入最新版本</a>
        </p>
      ) : (
        <GovernanceError error={error} />
      )}
    </form>
  );
}
```

- [ ] **Step 6: Write editing page**

```tsx
// src/app/w/[workspaceId]/knowledge/[sourceId]/[documentId]/edit/page.tsx
import { notFound } from "next/navigation";
import { DocumentEditor } from "@/components/knowledge/document-editor";
import { getKnowledgeDocumentModel, getKnowledgeExplorerModel, getWorkspaceShellModel } from "@/server/knowledge-read";

export default async function EditDocumentPage({
  params,
}: {
  params: Promise<{ workspaceId: string; sourceId: string; documentId: string }>;
}) {
  const { workspaceId, sourceId, documentId } = await params;
  const model = await getKnowledgeDocumentModel(workspaceId, sourceId, documentId);
  const explorer = await getKnowledgeExplorerModel(workspaceId, sourceId);
  const shell = await getWorkspaceShellModel(workspaceId);
  // Hiding the entry point is not the boundary; the server refuses here too.
  if (!model || !explorer || !shell) notFound();
  if (!shell.access.actions.canWrite) notFound();
  if (explorer.source.ownership !== "HUB_MANAGED") notFound();
  if (model.view.status !== "ACTIVE") notFound();

  return (
    <DocumentEditor
      workspaceId={workspaceId}
      sourceId={sourceId}
      documentId={documentId}
      expectedCurrentRevisionId={model.view.currentRevision.id}
      initialTitle={model.view.currentRevision.title}
      initialMarkdown={model.view.currentRevision.markdown}
    />
  );
}
```

- [ ] **Step 7: Complete gate**

Run: `npm run test:unit && npm run typecheck && npm run lint && npm run build`
Expected: all exit 0.

- [ ] **Step 8: Commit**

```bash
git add tests/unit/phase5-can-write.test.ts src/server/workspace-admin.ts src/components/knowledge/document-editor.tsx "src/app/w/[workspaceId]/knowledge/[sourceId]/[documentId]/edit/page.tsx"
git commit -m "feat: add the document editor page behind canWrite"
```

---

### Task 7: Document Page Edit Entry

**Files:**
- Modify: `src/components/knowledge/document-header.tsx:19-33`、`:71-75`
- Modify: `src/components/knowledge/document-inspector.tsx:188-235`
- Modify: `src/app/w/[workspaceId]/knowledge/[sourceId]/[documentId]/page.tsx:83-115`

**Interfaces:**
- Consumes: Task 6 `WorkspaceActions.canWrite`, existing `SourceView.ownership`
- Produces: Add an `editHref: string | null` prop to both `DocumentHeader` and `DocumentDetailClient`; when `null`, hide Edit and retain the `Read only` badge

- [ ] **Step 1: Change `DocumentHeader`**

Add `editHref: string | null;` to props and `editHref` to destructured arguments. Replace the Details button at lines 63–69 with a side-by-side container:

```tsx
          <div className="flex shrink-0 items-center gap-2">
            {editHref ? (
              <a
                href={editHref}
                className="inline-flex h-8 items-center rounded-md border border-kh-border bg-kh-bg px-3 text-[13px] font-medium text-kh-text hover:bg-kh-bg-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-kh-accent"
              >
                Edit
              </a>
            ) : null}
            <button
              type="button"
              onClick={onDetailsClick}
              className="inline-flex h-8 shrink-0 items-center rounded-md border border-kh-border bg-kh-bg px-3 text-[13px] font-medium text-kh-text hover:bg-kh-bg-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-kh-accent"
            >
              Details
            </button>
          </div>
```

Change the badge at line 72 to display only when editing is unavailable:

```tsx
          {editHref ? null : <Badge variant="outline">Read only</Badge>}
```

- [ ] **Step 2: Change `DocumentDetailClient`**

Add `editHref: string | null;` to its props, add `editHref` to destructured arguments, and pass it unchanged to `<DocumentHeader … editHref={editHref} />`.

- [ ] **Step 3: Change document page**

In `page.tsx`, add after existing `const shell = await getWorkspaceShellModel(workspaceId);`:

```tsx
  const canEdit =
    shell?.access.actions.canWrite === true &&
    explorer?.source.ownership === "HUB_MANAGED" &&
    view.status === "ACTIVE" &&
    !isHistorical;
  const editHref = canEdit ? `/w/${workspaceId}/knowledge/${sourceId}/${documentId}/edit` : null;
```

Add `editHref={editHref}` to `<DocumentDetailClient` props.

- [ ] **Step 4: Verify**

Run: `npm run test:unit && npm run typecheck && npm run lint && npm run build`
Expected: all exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/components/knowledge/document-header.tsx src/components/knowledge/document-inspector.tsx "src/app/w/[workspaceId]/knowledge/[sourceId]/[documentId]/page.tsx"
git commit -m "feat: show Edit on hub-managed documents"
```

---

### Task 8: Creation and Upload Entries

`/w/[id]/knowledge` is a redirect-only page (returns `KnowledgeEmptyState` when no Source exists) with no layout for a button, so entry points belong in the empty state and sidebar. Both are client components beneath `AppShell`'s `WorkspaceAuthorizationContext` (`app-shell.tsx:41`).

**Files:**
- Create: `src/components/knowledge/new-document-form.tsx`
- Modify: `src/components/knowledge/knowledge-empty-state.tsx`
- Modify: `src/components/knowledge/source-sidebar.tsx:76-97`

**Interfaces:**
- Consumes: Task 4 `POST /api/workspaces/{id}/documents`, Task 6 `canWrite`
- Produces: `NewDocumentForm({ workspaceId, variant })`，`variant: "empty" | "sidebar"`

- [ ] **Step 1: Write creation form**

```tsx
// src/components/knowledge/new-document-form.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWorkspaceAuthorization } from "@/components/shell/use-workspace-authorization";
import { GovernanceError, governanceFailure, governanceRequest, type GovernanceFailure } from "@/components/workspaces/governance-error";

type Created = { documentId: string; sourceId: string };

export function NewDocumentForm({ workspaceId, variant }: { workspaceId: string; variant: "empty" | "sidebar" }) {
  const router = useRouter();
  const { access, confirmed } = useWorkspaceAuthorization();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<GovernanceFailure | null>(null);

  if (!access.actions.canWrite) return null;

  async function create(body: unknown) {
    if (busy || !confirmed) return;
    setBusy(true);
    setError(null);
    try {
      const created = await governanceRequest<Created>(`/api/workspaces/${workspaceId}/documents`, "POST", body);
      router.push(`/w/${workspaceId}/knowledge/${created.sourceId}/${created.documentId}`);
      router.refresh();
    } catch (failure) {
      setError(governanceFailure(failure));
    } finally {
      setBusy(false);
    }
  }

  async function upload(file: File) {
    await create({ filename: file.name, markdown: await file.text() });
  }

  return (
    <div className={variant === "empty" ? "w-full space-y-3" : "space-y-2"}>
      {open ? (
        <form
          className="space-y-2"
          onSubmit={(event) => { event.preventDefault(); void create({ title, markdown: "" }); }}
        >
          <label className="block text-sm text-kh-text">
            Document title
            <Input className="mt-1" value={title} maxLength={512} required autoFocus disabled={busy} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <div className="flex gap-2">
            <Button type="submit" disabled={busy || !confirmed || !title.trim()}>Create</Button>
            <Button type="button" className="bg-transparent text-kh-text hover:brightness-100" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button>
          </div>
        </form>
      ) : (
        <Button type="button" disabled={busy || !confirmed} onClick={() => setOpen(true)}>New document</Button>
      )}
      <label className="block text-sm text-kh-text-muted">
        <span className="cursor-pointer underline-offset-4 hover:underline">Upload .md</span>
        <input
          type="file"
          accept=".md,.markdown"
          className="sr-only"
          disabled={busy || !confirmed}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void upload(file);
          }}
        />
      </label>
      <GovernanceError error={error} />
    </div>
  );
}
```

- [ ] **Step 2: Wire into empty state**

Change `src/components/knowledge/knowledge-empty-state.tsx` to:

```tsx
"use client";
import Link from "next/link";
import { useWorkspaceAuthorization } from "@/components/shell/use-workspace-authorization";
import { NewDocumentForm } from "./new-document-form";

export function KnowledgeEmptyState() {
  const { access, confirmed } = useWorkspaceAuthorization();
  return <section className="mx-auto flex max-w-3xl flex-col items-start gap-4 px-6 py-16">
    <h1 className="text-2xl font-semibold">Knowledge</h1>
    <p className="text-sm text-kh-text-muted">No knowledge sources yet.</p>
    <NewDocumentForm workspaceId={access.workspace.id} variant="empty" />
    {access.actions.canImport && confirmed && <Link className="rounded-md bg-kh-accent px-4 py-2 text-sm font-medium text-white" href={`/w/${access.workspace.id}/sources/import`}>
      {access.workspace.type === "PERSONAL" ? "Import your first knowledge source" : "Import knowledge"}
    </Link>}
  </section>;
}
```

- [ ] **Step 3: Wire into sidebar**

At the top of `src/components/knowledge/source-sidebar.tsx`, add `import { NewDocumentForm } from "./new-document-form";`; insert after `SourceSelector` inside the `<div className="flex flex-col gap-2 border-b border-kh-border pb-3">` block at lines 77–97:

```tsx
        <NewDocumentForm workspaceId={workspaceId} variant="sidebar" />
```

- [ ] **Step 4: Verify**

Run: `npm run test:unit && npm run typecheck && npm run lint && npm run build`
Expected: all exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/components/knowledge/new-document-form.tsx src/components/knowledge/knowledge-empty-state.tsx src/components/knowledge/source-sidebar.tsx
git commit -m "feat: add document create and upload entry points"
```

---

### Task 9: E2E and Fixtures

**Files:**
- Modify: `scripts/db/seed.ts`(`BROWSER_FIXTURE_IDS` and `seedBrowserFixtures`)
- Create: `tests/e2e/phase5-authoring.spec.ts`

**Interfaces:**
- Consumes: All Task 4–8 deliverables
- Produces: `BROWSER_FIXTURE_IDS.emptyWorkspace = "0199f100-0000-7000-8000-000000000004"`, a Workspace with OWNER membership and **no Sources**

- [ ] **Step 1: Add fixture**

Add to `BROWSER_FIXTURE_IDS` in `scripts/db/seed.ts`:

```typescript
  emptyWorkspace: "0199f100-0000-7000-8000-000000000004",
```

In the first `unitOfWork.run` block in `seedBrowserFixtures`, add a fourth line directly after the existing three `ensureWorkspace` lines, and include it in the existing membership loop:

```typescript
    await ensureWorkspace(repositories, BROWSER_FIXTURE_IDS.emptyWorkspace, "Empty Workspace", identity.id, now);
```

Change that loop's array to:

```typescript
    for (const workspaceId of [BROWSER_FIXTURE_IDS.queryMasterWorkspace, BROWSER_FIXTURE_IDS.swfpWorkspace, BROWSER_FIXTURE_IDS.emptyWorkspace]) {
```

**Never** call `ensureSource` for this Workspace: its absence of Sources is the point of the test. Also **do not** insert anything that writes to the `obsidianWikiSource` tree before the `treeCount.length === 0` new-database check (see comments at `scripts/db/seed.ts:111-113` and the similar incident in Phase 4 verification).

- [ ] **Step 2: Write E2E**

```typescript
// tests/e2e/phase5-authoring.spec.ts
import { expect, test } from "@playwright/test";

// Mirrors scripts/db/seed.ts BROWSER_FIXTURE_IDS.
const EMPTY_WORKSPACE = "0199f100-0000-7000-8000-000000000004";
const QUERY_MASTER_WORKSPACE = "0199f100-0000-7000-8000-000000000001";

test("creates the first document in a workspace with no sources", async ({ page }) => {
  await page.goto(`/w/${EMPTY_WORKSPACE}/knowledge`);
  await page.getByRole("button", { name: "New document" }).click();
  await page.getByLabel("Document title").fill("My First Note");
  await page.getByRole("button", { name: "Create" }).click();

  await expect(page.getByRole("heading", { name: "My First Note" })).toBeVisible();
});

test("edits a hub-managed document and records a second revision", async ({ page }) => {
  await page.goto(`/w/${EMPTY_WORKSPACE}/knowledge`);
  await page.getByRole("button", { name: "New document" }).click();
  await page.getByLabel("Document title").fill("Editable Note");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("heading", { name: "Editable Note" })).toBeVisible();

  await page.getByRole("link", { name: "Edit" }).click();
  await page.getByLabel("Markdown").fill("updated body");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.getByText("updated body")).toBeVisible();
  await page.getByRole("button", { name: "Details" }).click();
  await page.getByRole("tab", { name: "History" }).click();
  await expect(page.getByRole("link", { name: /Revision 2/ })).toBeVisible();
});

test("uploads a markdown file and takes its title from frontmatter", async ({ page }) => {
  await page.goto(`/w/${EMPTY_WORKSPACE}/knowledge`);
  await page.setInputFiles('input[type="file"]', {
    name: "leave.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("---\ntitle: 請假流程 Uploaded\n---\n\n內容\n", "utf8"),
  });
  await expect(page.getByRole("heading", { name: "請假流程 Uploaded" })).toBeVisible();
});

test("never shows Edit on source-managed content", async ({ page }) => {
  await page.goto(`/w/${QUERY_MASTER_WORKSPACE}/knowledge`);
  await expect(page.getByText("Read only")).toBeVisible();
  await expect(page.getByRole("link", { name: "Edit" })).toHaveCount(0);
});
```

- [ ] **Step 3: Run E2E**

Run: `npm run test:e2e -- tests/e2e/phase5-authoring.spec.ts`
Expected: PASS(4 cases)。

The last case assumes the seeded `obsidianWikiSource` is SOURCE_MANAGED. If it is actually HUB_MANAGED (`scripts/db/seed.ts:68` creates `sourceType: "HUB"`), the case fails because seed has no ready SOURCE_MANAGED fixture. Add a Source with `sourceType: "FOLDER_SYNC"` / `ownership: "SOURCE_MANAGED"` and a document to `seedBrowserFixtures` (copy field patterns from the secret-document block at `scripts/db/seed.ts:92-107`, likewise after the empty-table check in a separate `unitOfWork.run`), and target it in the test. **Do not** delete the case.

- [ ] **Step 4: Run all three gates**

Run: `npm run test:unit && npm run typecheck && npm run lint && npm run build`
Run: `npm run test:integration`
Run: `npm run test:e2e`
Expected: all three exit 0, with no regressions in existing cases.

- [ ] **Step 5: Commit**

```bash
git add scripts/db/seed.ts tests/e2e/phase5-authoring.spec.ts
git commit -m "test: cover Phase 5 authoring end to end"
```

---

### Task 10: Acceptance Record

**Files:**
- Create: `docs/superpowers/verification/2026-09-16-phase-5-human-authoring-verification.md`

- [ ] **Step 1: Rerun all three gates and record actual output verbatim**

Run: `npm run test:unit`、`npm run typecheck`、`npm run lint`、`npm run build`、`npm run test:integration`、`npm run test:e2e`

- [ ] **Step 2: Write acceptance record**

Follow the structure of `docs/superpowers/verification/2026-09-16-phase-4-discovery-read-api-verification.md`: environment table, commands/results table, mapping each test ID in spec §9 (U1–U5, I1–I10, E1–E4) to actual test files and case names, and “Known gaps.”

**Honesty requirement**: record any skipped, expectation-modified, or unimplementable cases under “Known gaps” rather than deleting them from the table. Do not enter results for commands that were not run.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/verification/2026-09-16-phase-5-human-authoring-verification.md
git commit -m "docs: record the Phase 5 verification run"
```

---

## Self-Review

**Spec coverage**

| Spec section | Task |
| --- | --- |
| §5 Default Hub Source Lazy Provisioning(including §5.2 lock ordering, §5.3 concurrency, §5.4 authorization verb) | 3 |
| §6.1 Two Routes | 4、5 |
| §6.2 Upload Does Not Have a Separate Route | 2、4 |
| §6.3 Unchanged requestFields + Metadata Preservation | 2、5 |
| §6.4 Limits | 2 |
| §7.1 Authorization | 3、4、6 |
| §7.2 Extended Error Mapping | 1 |
| §8.1 canWrite | 6 |
| §8.2 Editing page | 6 |
| §8.3 Entries and Badge | 7、8 |
| §8.4 Conflict Presentation | 6 |
| §9.1 U1–U5 | 6（U1）、2（U2、U3、U5）、1（U4） |
| §9.2 I1–I10 | 3（I1、I2）、4（I3–I8）、4(I9 covered by My Space, see gaps below)、2(I10 at unit layer) |
| §9.3 E1–E4 | 9 |
| §9.4 Fixture | 9 |
| §10 Acceptance Criteria | 10 |

**Known deviations (intentional)**

- Spec §9.2 I9 (My Space supports creation and editing) has no separate integration case: `assertPersonalMutationAllowed` (`personal-workspace-service.ts:38`) returns directly for `content-write`, following the same path as Team; Tasks 3/4 cover that path. If needed, add a Task 4 case creating in a PERSONAL workspace.
- Spec §9.2 I10 (three title sources for single-document uploads) is at the unit layer (Task 2), rather than integration: title resolution is pure and DB testing adds no coverage. E2E also has a frontmatter case (Task 9).

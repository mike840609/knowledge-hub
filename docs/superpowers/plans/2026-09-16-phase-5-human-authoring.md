# Phase 5 Human Authoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓使用者在 Web 上建立、上傳與編輯 HUB_MANAGED 文件，變更保存為 immutable Revision，並在並行編輯時得到明確衝突提示。

**Architecture:** Phase 1 已經提供完整的寫入 domain（`createDocument`／`createRevision`、`document.write` capability gate、HUB_MANAGED guard、`expectedCurrentRevisionId` 衝突檢查）。本 Phase 只補三樣東西：預設 Hub Source 的 lazy provisioning、兩條 HTTP 路由、一個編輯頁。不新增 schema、migration、port 或 domain 規則。

**Tech Stack:** Next.js 15 App Router、React 19、TypeScript、Tailwind、MariaDB 10.11、vitest 2、Playwright 1.55。

**Spec:** `docs/superpowers/specs/2026-09-16-phase-5-human-authoring-design.md`

## Global Constraints

- 所有寫入必須經 `lockWorkspaceForMutation(repositories, caller, workspaceId, "content-write")`，該函式要求 `document.write` capability。
- 路由與 body 裡的任何 ID 都不是授權證明；caller 只能來自 `services.establishTrustedCaller()`。
- `metadata` 不開放編輯，一律沿用既有值或 `{}`。
- 上限：`title` 512 字元、`markdown` 5 MiB（5 \* 1024 \* 1024 bytes，對齊 `KM_IMPORT_MAX_MARKDOWN_FILE_BYTES` 預設值）。
- 預設 Hub Source 名稱固定為 `Notes`。
- 新 UI 沿用 `kh-*` token；不引入任何新依賴（編輯器用既有 `ui/input.tsx` 與 `ui/textarea.tsx`）。
- **測試指令**：unit 可單檔（`npm run test:unit -- <path>`）；**integration 無法單檔**，`scripts/test/integration.ts:9` 的 `runVitest()` 參數寫死、不轉傳 `process.argv`，只能整套跑 `npm run test:integration`；e2e 可單檔（`scripts/test/e2e.ts:117` 會轉傳參數）。
- 每個 task 結束前 `npm run typecheck && npm run lint` 必須乾淨。

---

## File Structure

| 檔案 | 責任 | Task |
| --- | --- | --- |
| `src/server/http-error-response.ts`（改） | 補 Phase 5 錯誤碼的狀態碼映射 | 1 |
| `src/server/authoring-input.ts`（新） | 純函式：解析與驗證建立／編輯的 request body | 2 |
| `src/modules/sources/application/ensure-default-hub-source.ts`（新） | 預設 `Notes` Source 的 lazy provisioning | 3 |
| `src/app/api/workspaces/[workspaceId]/documents/route.ts`（新） | `POST` 建立／上傳 | 4 |
| `src/app/api/documents/[documentId]/route.ts`（新） | `PATCH` 建立新 Revision | 5 |
| `src/server/workspace-admin.ts`（改） | `WorkspaceActions.canWrite` | 6 |
| `src/components/knowledge/document-editor.tsx`（新） | 編輯表單 client component | 6 |
| `src/app/w/[workspaceId]/knowledge/[sourceId]/[documentId]/edit/page.tsx`（新） | 編輯頁 | 6 |
| `src/components/knowledge/document-header.tsx`（改） | Edit 按鈕與 ownership-aware badge | 7 |
| `src/components/knowledge/document-inspector.tsx`（改） | 把 ownership／canWrite 傳給 header | 7 |
| `src/app/w/[workspaceId]/knowledge/[sourceId]/[documentId]/page.tsx`（改） | 傳入 ownership | 7 |
| `src/components/knowledge/knowledge-empty-state.tsx`（改） | 空 Workspace 的建立入口 | 8 |
| `src/components/knowledge/new-document-form.tsx`（新） | 建立／上傳表單 | 8 |
| `src/components/knowledge/source-sidebar.tsx`（改） | 常駐建立入口 | 8 |
| `scripts/db/seed.ts`（改） | 無 Hub Source 的 Workspace fixture | 9 |
| `tests/e2e/phase5-authoring.spec.ts`（新） | E2E | 9 |

---

### Task 1: 錯誤碼映射

沒有這一步，stale-editor 衝突會回 500 而不是 409：`toWorkspaceErrorResponse` 未列出的 `DomainError` 一律落到 500。

**Files:**
- Modify: `src/server/http-error-response.ts:61-70`
- Test: `tests/unit/phase5-error-mapping.test.ts`

**Interfaces:**
- Consumes: 既有 `toWorkspaceErrorResponse(error: unknown): { status: number; body: ApiErrorBody }`
- Produces: 同一個函式，新增對 `REVISION_CONFLICT`／`SOURCE_MANAGED_READ_ONLY`／`SOURCE_ARCHIVED`／`DOCUMENT_ARCHIVED` → 409，`INVALID_TITLE`／`INVALID_METADATA` → 400，`DOCUMENT_NOT_FOUND`／`SOURCE_NOT_FOUND` → 404 的映射

- [ ] **Step 1: 寫失敗測試**

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

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm run test:unit -- tests/unit/phase5-error-mapping.test.ts`
Expected: FAIL — 目前每一個都回 500。

- [ ] **Step 3: 實作**

在 `src/server/http-error-response.ts` 把 `DOCUMENT_NOT_FOUND` 與 `SOURCE_NOT_FOUND` 加進既有的 `HIDDEN_NOT_FOUND`：

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

再把 `toWorkspaceErrorResponse` 的兩條清單各自加上 Phase 5 的碼：

```typescript
    const status = ["INSUFFICIENT_WORKSPACE_CAPABILITY", "TEAM_CREATION_DENIED", "PERSONAL_WORKSPACE_FROZEN"].includes(error.code) ? 403
      : ["WORKSPACE_ARCHIVED", "LAST_DIRECT_OWNER", "MEMBER_ALREADY_EXISTS", "GROUP_MAPPING_ALREADY_EXISTS", "WORKSPACE_LIFECYCLE_VIOLATION",
         "REVISION_CONFLICT", "SOURCE_MANAGED_READ_ONLY", "SOURCE_ARCHIVED", "DOCUMENT_ARCHIVED"].includes(error.code) ? 409
      : ["MEMBER_NOT_FOUND", "INVALID_ROLE_ASSIGNMENT", "INVALID_WORKSPACE_NAME", "INVALID_REQUEST",
         "INVALID_TITLE", "INVALID_METADATA", "VALIDATION_ERROR"].includes(error.code) ? 400 : 500;
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npm run test:unit -- tests/unit/phase5-error-mapping.test.ts`
Expected: PASS（5 個案例）

- [ ] **Step 5: 確認沒有回歸**

Run: `npm run test:unit && npm run typecheck && npm run lint`
Expected: 全部 exit 0。

- [ ] **Step 6: Commit**

```bash
git add tests/unit/phase5-error-mapping.test.ts src/server/http-error-response.ts
git commit -m "fix: map Phase 5 authoring domain errors to real status codes"
```

---

### Task 2: Request body 解析（純函式）

把 body 驗證抽成純函式，讓上限、互斥與 title resolution 都能在不打 DB 的情況下測。

**Files:**
- Create: `src/server/authoring-input.ts`
- Test: `tests/unit/phase5-authoring-input.test.ts`

**Interfaces:**
- Consumes: `parseGenericMarkdownText`（`src/modules/sources/adapters/generic-markdown-folder-adapter.ts:86`）、`resolveImportTitle`（`src/modules/sources/domain/import-title.ts:6`）
- Produces:
  - `MAX_TITLE_LENGTH: 512`、`MAX_MARKDOWN_BYTES: 5242880`
  - `parseCreateDocumentInput(body: unknown): { title: string; markdown: string }`
  - `parseUpdateDocumentInput(body: unknown): { title: string; markdown: string; expectedCurrentRevisionId: string }`
  - 兩者驗證失敗都丟 `DomainError("INVALID_REQUEST", …)`

- [ ] **Step 1: 寫失敗測試**

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

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm run test:unit -- tests/unit/phase5-authoring-input.test.ts`
Expected: FAIL — `Cannot find module '@/server/authoring-input'`

- [ ] **Step 3: 實作**

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

- [ ] **Step 4: 跑測試確認通過**

Run: `npm run test:unit -- tests/unit/phase5-authoring-input.test.ts`
Expected: PASS。

若因 `parseGenericMarkdownText` 的回傳欄位名不符而失敗，先執行 `grep -n "return" -B 12 src/modules/sources/adapters/generic-markdown-folder-adapter.ts` 確認實際欄位名稱，並據此調整上面的 `parsed.frontmatterTitle` / `parsed.firstH1`，**不要**改動測試的預期標題。

- [ ] **Step 5: Commit**

```bash
git add tests/unit/phase5-authoring-input.test.ts src/server/authoring-input.ts
git commit -m "feat: parse and validate authoring request bodies"
```

---

### Task 3: 預設 Hub Source lazy provisioning

**Files:**
- Create: `src/modules/sources/application/ensure-default-hub-source.ts`
- Test: `tests/integration/phase5-default-hub-source.test.ts`

**Interfaces:**
- Consumes: `SourceUnitOfWork`（`src/modules/sources/ports/unit-of-work.ts:31`）、`lockWorkspaceForMutation`、`uuidv7`
- Produces: `DEFAULT_HUB_SOURCE_NAME = "Notes"`、`ensureDefaultHubSource(unitOfWork: SourceUnitOfWork, caller: CallerContext, workspaceId: string): Promise<string>`（回傳 sourceId）

- [ ] **Step 1: 寫失敗測試**

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

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm run test:integration`
Expected: FAIL — `Cannot find module '@/modules/sources/application/ensure-default-hub-source'`。（整合測試無法只跑單檔，見 Global Constraints。）

- [ ] **Step 3: 實作**

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

- [ ] **Step 4: 跑測試確認通過**

Run: `npm run test:integration`
Expected: PASS — 新增 4 個案例，既有案例不得有任何回歸。

- [ ] **Step 5: Commit**

```bash
git add tests/integration/phase5-default-hub-source.test.ts src/modules/sources/application/ensure-default-hub-source.ts
git commit -m "feat: lazily provision the default Notes hub source"
```

---

### Task 4: 建立與上傳路由

**Files:**
- Create: `src/app/api/workspaces/[workspaceId]/documents/route.ts`
- Test: `tests/integration/phase5-authoring-service.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `parseCreateDocumentInput`、Task 3 的 `ensureDefaultHubSource`、既有 `workspaceHttp`、`services.hub.createDocument`
- Produces: `POST` 回 `{ documentId, sourceId, revisionId }`

這個 task 的整合測試直接測 service 組合（`ensureDefaultHubSource` + `createDocument`），不經 HTTP；路由層只是薄接線，由 Task 9 的 E2E 覆蓋。

- [ ] **Step 1: 寫失敗測試**

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

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm run test:integration`
Expected: FAIL。

注意最後一個案例用了 `repositories.connection?.query?.` 這個未必存在的逃生口。若該欄位不存在導致案例無法執行，改用既有的 seed fixture 取得 SOURCE_MANAGED source：以 `repositories.sources.insert` 建一個 `sourceType: "FOLDER_SYNC"` / `ownership: "SOURCE_MANAGED"` 的 source，再直接用 `repositories.documents.insertDraft` + `repositories.revisions.insert` + `repositories.tree.insert` 在該 source 下建一份文件（三者的欄位寫法照抄 `scripts/db/seed.ts:92-107`），然後對它呼叫 `createRevision`。**不要**刪掉這個案例。

- [ ] **Step 3: 實作路由**

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

- [ ] **Step 4: 跑測試確認通過**

Run: `npm run test:integration && npm run typecheck && npm run lint`
Expected: 全部 exit 0。

- [ ] **Step 5: Commit**

```bash
git add tests/integration/phase5-authoring-service.test.ts "src/app/api/workspaces/[workspaceId]/documents/route.ts"
git commit -m "feat: add the document create and upload route"
```

---

### Task 5: 編輯路由

**Files:**
- Create: `src/app/api/documents/[documentId]/route.ts`
- Test: `tests/unit/phase5-update-route.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `parseUpdateDocumentInput`、`services.queries.getCurrentRevision`、`services.hub.createRevision`
- Produces: `PATCH` 回 `{ revisionId, revisionNo, changed }`

- [ ] **Step 1: 寫失敗測試**

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

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm run test:unit -- tests/unit/phase5-update-route.test.ts`
Expected: FAIL — 找不到模組。

- [ ] **Step 3: 實作**

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

- [ ] **Step 4: 跑測試確認通過**

Run: `npm run test:unit -- tests/unit/phase5-update-route.test.ts`
Expected: PASS（3 個案例）。

若 `WorkspaceRouteContext` 的型別與 `DocumentRouteContext` 衝突導致 typecheck 失敗，保留上面本地宣告的 `DocumentRouteContext`，不要改動 `workspace-http.ts` 的共用型別。

- [ ] **Step 5: 完整 gate**

Run: `npm run test:unit && npm run typecheck && npm run lint`
Expected: 全部 exit 0。

- [ ] **Step 6: Commit**

```bash
git add tests/unit/phase5-update-route.test.ts "src/app/api/documents/[documentId]/route.ts"
git commit -m "feat: add the document edit route preserving stored metadata"
```

---

### Task 6: canWrite action 與編輯頁

**Files:**
- Modify: `src/server/workspace-admin.ts:10-16`、`:40-58`
- Create: `src/components/knowledge/document-editor.tsx`
- Create: `src/app/w/[workspaceId]/knowledge/[sourceId]/[documentId]/edit/page.tsx`
- Test: `tests/unit/phase5-can-write.test.ts`

**Interfaces:**
- Consumes: 既有 `deriveWorkspaceActions(workspace, capabilities)`
- Produces: `WorkspaceActions.canWrite: boolean`

- [ ] **Step 1: 寫失敗測試**

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

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm run test:unit -- tests/unit/phase5-can-write.test.ts`
Expected: FAIL — `canWrite` 不存在（typecheck 層級的錯誤）。

- [ ] **Step 3: 加上 action**

在 `src/server/workspace-admin.ts` 的 `WorkspaceActions` type 內，緊接 `canSearch: boolean;` 之後加入：

```typescript
  canWrite: boolean;
```

在 `deriveWorkspaceActions` 的回傳物件內，緊接 `canSearch: has("document.read"),` 之後加入：

```typescript
    canWrite: has("document.write"),
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npm run test:unit -- tests/unit/phase5-can-write.test.ts`
Expected: PASS。

- [ ] **Step 5: 寫編輯器元件**

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

- [ ] **Step 6: 寫編輯頁**

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

- [ ] **Step 7: 完整 gate**

Run: `npm run test:unit && npm run typecheck && npm run lint && npm run build`
Expected: 全部 exit 0。

- [ ] **Step 8: Commit**

```bash
git add tests/unit/phase5-can-write.test.ts src/server/workspace-admin.ts src/components/knowledge/document-editor.tsx "src/app/w/[workspaceId]/knowledge/[sourceId]/[documentId]/edit/page.tsx"
git commit -m "feat: add the document editor page behind canWrite"
```

---

### Task 7: 文件頁的 Edit 入口

**Files:**
- Modify: `src/components/knowledge/document-header.tsx:19-33`、`:71-75`
- Modify: `src/components/knowledge/document-inspector.tsx:188-235`
- Modify: `src/app/w/[workspaceId]/knowledge/[sourceId]/[documentId]/page.tsx:83-115`

**Interfaces:**
- Consumes: Task 6 的 `WorkspaceActions.canWrite`、既有 `SourceView.ownership`
- Produces: `DocumentHeader` 與 `DocumentDetailClient` 各新增一個 `editHref: string | null` prop；為 `null` 時不顯示 Edit 並保留 `Read only` badge

- [ ] **Step 1: 改 `DocumentHeader`**

在 props 型別中加入 `editHref: string | null;`，並在解構參數加入 `editHref`。把第 63-69 行的 Details 按鈕改成一個並排容器：

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

把第 72 行的 badge 改成只在不可編輯時顯示：

```tsx
          {editHref ? null : <Badge variant="outline">Read only</Badge>}
```

- [ ] **Step 2: 改 `DocumentDetailClient`**

在其 props 型別加入 `editHref: string | null;`，解構參數加入 `editHref`，並把它原樣傳給 `<DocumentHeader … editHref={editHref} />`。

- [ ] **Step 3: 改文件頁**

在 `page.tsx` 既有的 `const shell = await getWorkspaceShellModel(workspaceId);` 之後加入：

```tsx
  const canEdit =
    shell?.access.actions.canWrite === true &&
    explorer?.source.ownership === "HUB_MANAGED" &&
    view.status === "ACTIVE" &&
    !isHistorical;
  const editHref = canEdit ? `/w/${workspaceId}/knowledge/${sourceId}/${documentId}/edit` : null;
```

並在 `<DocumentDetailClient` 的 props 中加入 `editHref={editHref}`。

- [ ] **Step 4: 驗證**

Run: `npm run test:unit && npm run typecheck && npm run lint && npm run build`
Expected: 全部 exit 0。

- [ ] **Step 5: Commit**

```bash
git add src/components/knowledge/document-header.tsx src/components/knowledge/document-inspector.tsx "src/app/w/[workspaceId]/knowledge/[sourceId]/[documentId]/page.tsx"
git commit -m "feat: show Edit on hub-managed documents"
```

---

### Task 8: 建立與上傳入口

`/w/[id]/knowledge` 是純導向頁（沒有 Source 時回 `KnowledgeEmptyState`），沒有版面可掛按鈕，所以入口落在空狀態與側邊欄兩處。兩者都是 client component 且都在 `AppShell` 的 `WorkspaceAuthorizationContext`（`app-shell.tsx:41`）之下。

**Files:**
- Create: `src/components/knowledge/new-document-form.tsx`
- Modify: `src/components/knowledge/knowledge-empty-state.tsx`
- Modify: `src/components/knowledge/source-sidebar.tsx:76-97`

**Interfaces:**
- Consumes: Task 4 的 `POST /api/workspaces/{id}/documents`、Task 6 的 `canWrite`
- Produces: `NewDocumentForm({ workspaceId, variant })`，`variant: "empty" | "sidebar"`

- [ ] **Step 1: 寫建立表單**

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

- [ ] **Step 2: 接到空狀態**

把 `src/components/knowledge/knowledge-empty-state.tsx` 改成：

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

- [ ] **Step 3: 接到側邊欄**

在 `src/components/knowledge/source-sidebar.tsx` 頂部加入 `import { NewDocumentForm } from "./new-document-form";`，並在第 77-97 行那個 `<div className="flex flex-col gap-2 border-b border-kh-border pb-3">` 區塊內、`SourceSelector` 之後插入：

```tsx
        <NewDocumentForm workspaceId={workspaceId} variant="sidebar" />
```

- [ ] **Step 4: 驗證**

Run: `npm run test:unit && npm run typecheck && npm run lint && npm run build`
Expected: 全部 exit 0。

- [ ] **Step 5: Commit**

```bash
git add src/components/knowledge/new-document-form.tsx src/components/knowledge/knowledge-empty-state.tsx src/components/knowledge/source-sidebar.tsx
git commit -m "feat: add document create and upload entry points"
```

---

### Task 9: E2E 與 fixture

**Files:**
- Modify: `scripts/db/seed.ts`（`BROWSER_FIXTURE_IDS` 與 `seedBrowserFixtures`）
- Create: `tests/e2e/phase5-authoring.spec.ts`

**Interfaces:**
- Consumes: Task 4–8 的全部交付
- Produces: `BROWSER_FIXTURE_IDS.emptyWorkspace = "0199f100-0000-7000-8000-000000000004"`，一個有 OWNER membership、但**沒有任何 Source** 的 Workspace

- [ ] **Step 1: 加 fixture**

在 `scripts/db/seed.ts` 的 `BROWSER_FIXTURE_IDS` 內加入：

```typescript
  emptyWorkspace: "0199f100-0000-7000-8000-000000000004",
```

在 `seedBrowserFixtures` 的第一個 `unitOfWork.run` 區塊內，緊接既有三行 `ensureWorkspace` 之後加入第四行，並把它納入既有的 membership 迴圈：

```typescript
    await ensureWorkspace(repositories, BROWSER_FIXTURE_IDS.emptyWorkspace, "Empty Workspace", identity.id, now);
```

把該迴圈的陣列改成：

```typescript
    for (const workspaceId of [BROWSER_FIXTURE_IDS.queryMasterWorkspace, BROWSER_FIXTURE_IDS.swfpWorkspace, BROWSER_FIXTURE_IDS.emptyWorkspace]) {
```

**絕對不要**為這個 Workspace 呼叫 `ensureSource`——它沒有 Source 正是測試的重點。也**不要**在 `treeCount.length === 0` 這個「是否為全新資料庫」判斷之前插入任何會寫入 `obsidianWikiSource` tree 的東西（見 `scripts/db/seed.ts:111-113` 的註解與 Phase 4 verification 記錄的同類事故）。

- [ ] **Step 2: 寫 E2E**

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

- [ ] **Step 3: 跑 E2E**

Run: `npm run test:e2e -- tests/e2e/phase5-authoring.spec.ts`
Expected: PASS（4 個案例）。

最後一個案例假設 seed 的 `obsidianWikiSource` 是 SOURCE_MANAGED。若實際上它是 HUB_MANAGED（`scripts/db/seed.ts:68` 建的是 `sourceType: "HUB"`），該案例會失敗——這代表 seed 裡沒有現成的 SOURCE_MANAGED fixture。此時在 `seedBrowserFixtures` 內新增一個 `sourceType: "FOLDER_SYNC"` / `ownership: "SOURCE_MANAGED"` 的 Source 與一份文件（欄位寫法照抄 `scripts/db/seed.ts:92-107` 的 secret document 區塊，並同樣放在空表判斷之後、獨立的 `unitOfWork.run` 區塊內），再把測試指向它。**不要**刪掉這個案例。

- [ ] **Step 4: 三個 gate 全跑**

Run: `npm run test:unit && npm run typecheck && npm run lint && npm run build`
Run: `npm run test:integration`
Run: `npm run test:e2e`
Expected: 三者皆 exit 0，且既有案例零回歸。

- [ ] **Step 5: Commit**

```bash
git add scripts/db/seed.ts tests/e2e/phase5-authoring.spec.ts
git commit -m "test: cover Phase 5 authoring end to end"
```

---

### Task 10: 驗收記錄

**Files:**
- Create: `docs/superpowers/verification/2026-09-16-phase-5-human-authoring-verification.md`

- [ ] **Step 1: 重跑三個 gate，逐字記錄實際輸出**

Run: `npm run test:unit`、`npm run typecheck`、`npm run lint`、`npm run build`、`npm run test:integration`、`npm run test:e2e`

- [ ] **Step 2: 寫驗收記錄**

依 `docs/superpowers/verification/2026-09-16-phase-4-discovery-read-api-verification.md` 的結構撰寫：環境表、指令與結果表、spec §9 每個測試編號（U1–U5、I1–I10、E1–E4）對應到實際測試檔與案例名稱、以及「已知缺口」。

**誠實要求**：任何被跳過、修改預期值、或無法實作的案例，都必須寫進「已知缺口」而不是從表中刪除。未執行的指令不得填入結果。

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/verification/2026-09-16-phase-5-human-authoring-verification.md
git commit -m "docs: record the Phase 5 verification run"
```

---

## Self-Review

**Spec coverage**

| Spec 章節 | Task |
| --- | --- |
| §5 預設 Hub Source lazy provisioning（含 §5.2 鎖序、§5.3 併發、§5.4 授權動詞） | 3 |
| §6.1 兩條路由 | 4、5 |
| §6.2 upload 不另開路由 | 2、4 |
| §6.3 requestFields 零變更 + metadata 保留 | 2、5 |
| §6.4 上限 | 2 |
| §7.1 授權 | 3、4、6 |
| §7.2 錯誤映射擴充 | 1 |
| §8.1 canWrite | 6 |
| §8.2 編輯頁 | 6 |
| §8.3 入口與 badge | 7、8 |
| §8.4 衝突呈現 | 6 |
| §9.1 U1–U5 | 6（U1）、2（U2、U3、U5）、1（U4） |
| §9.2 I1–I10 | 3（I1、I2）、4（I3–I8）、4（I9 由 My Space 涵蓋，見下方缺口）、2（I10 在單元層） |
| §9.3 E1–E4 | 9 |
| §9.4 Fixture | 9 |
| §10 驗收條件 | 10 |

**已知偏離（刻意）**

- spec §9.2 的 I9（My Space 可建立與編輯）沒有獨立的整合測試案例：`assertPersonalMutationAllowed`（`personal-workspace-service.ts:38`）對 `content-write` 直接 return，與 Team 走完全相同的路徑，Task 3／4 的案例已涵蓋該路徑。若執行者認為需要，可在 Task 4 追加一個以 PERSONAL workspace 建立的案例。
- spec §9.2 的 I10（單篇 upload 的三種 title 來源）放在單元層（Task 2）而非整合層：title resolution 是純函式，打 DB 測不會增加任何覆蓋。E2E 另有一個 frontmatter 案例（Task 9）。

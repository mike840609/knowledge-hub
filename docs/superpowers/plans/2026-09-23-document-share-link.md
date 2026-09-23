# Document Share Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** My Space 的擁有者可以為單篇文件建立有期限、可撤銷的唯讀連結；任何持有連結的人不需登入即可在 `/s/:token` 讀到該文件的目前版本。

**Architecture:** 新增一張連結表與一張每日檢視計數表（migration 011），規則寫成 `knowledge` 模組 domain 層的純函式，由新的 `DocumentShareService` 協調。`readShared(token)` 是整個 codebase 唯一不接受 `CallerContext` 就回傳文件內容的方法，且經由一個不建構 identity provider 的獨立 composition 入口取得。UI 透過既有 action registry 新增一個動作，並以 window event 開啟分享對話框，與 `document.open-details` 相同的模式。

**Tech Stack:** Next.js 15 App Router、React 19、TypeScript、Tailwind、MariaDB 10.11、vitest 2、Playwright 1.55、`@base-ui-components/react` Dialog。

**Spec:** `docs/superpowers/specs/2026-09-23-document-share-link-design.md`（A0–A5 均已拍板）

## Global Constraints

- **token 一律 `crypto.randomUUID()`（UUIDv4）**，由 `ShareTokenIssuer` port 提供。禁止以 `uuidv7()` 產生 token（spec §8：同一毫秒內連號）。連結主鍵 `id` 與 audit 事件 `id` 仍用 `uuidv7()`。
- **不存 `workspace_id`／`source_id`**：範圍一律由 `Document → Source → Workspace` 推導（CLAUDE.md「Scope is derived」）。
- **所有權不是條件**：`SOURCE_MANAGED` 文件可以分享。任何 task 都不得加入 ownership 檢查。
- **`readShared` 沒有 caller 參數**，其他所有回傳文件內容的方法都必須經過 membership（Task 6 以掃描測試鎖住）。
- 建立與撤銷的鎖順序：`Source FOR UPDATE → Workspace FOR UPDATE`（Phase 3 §14.2「non-import existing Source」）。
- 建立與撤銷的 audit 事件與 mutation 同一個 transaction；payload 絕不含 token。
- 檢視計數在**獨立** transaction 寫入；失敗只 `console.warn`（訊息不含 token），照常回傳內容（A5）。
- 期限只接受 `1 | 7 | 30 | 90` 天，預設 30；每份文件最多 10 條有效連結；標籤最長 200 字元。
- API 回傳 `path`（`/s/<token>`），不回傳完整 URL；完整連結由瀏覽器以 `window.location.origin` 組成。
- 新 UI 只用 `frontend-design-language.md` 列出的 token；顏色只來自 `globals.css` 的 CSS 變數。
- **測試指令**：unit 可單檔（`npm run test:unit -- <path>`）；integration 只能整套跑（`npm run test:integration`，`scripts/test/integration.ts` 不轉傳參數）；e2e 可單檔（`npm run test:e2e -- <path>`）。
- 每個 task 結束前 `npm run typecheck && npm run lint` 必須乾淨。

---

## File Structure

| 檔案 | 責任 | Task |
| --- | --- | --- |
| `src/infrastructure/database/mariadb/migrations/011-document-share-links.ts`（新） | 兩張新表 | 1 |
| `src/infrastructure/database/mariadb/migrations/index.ts`（改） | 登錄 migration 011 | 1 |
| `src/modules/knowledge/domain/document-share-link.ts`（新） | 常數、型別、錯誤、建立與有效性純函式、UUIDv4 格式檢查 | 2 |
| `src/modules/knowledge/ports/document-share-link-repository.ts`（新） | 連結與檢視計數的 repository port | 3 |
| `src/modules/knowledge/ports/share-token-issuer.ts`（新） | token 產生 port | 3 |
| `src/modules/knowledge/ports/unit-of-work.ts`（改） | `KnowledgeRepositories` 加入 `shareLinks`、`auditEvents` | 3 |
| `src/infrastructure/database/mariadb/repositories/document-share-links.ts`（新） | MariaDB 實作 | 3 |
| `src/infrastructure/database/mariadb/repositories/index.ts`（改） | 組裝 `shareLinks` | 3 |
| `src/infrastructure/security/random-share-token-issuer.ts`（新） | `crypto.randomUUID()` adapter | 3 |
| `src/modules/knowledge/application/document-share-service.ts`（新） | `create`／`list`／`revoke`／`readShared` | 4、5 |
| `src/server/http-error-response.ts`（改） | 新錯誤碼的狀態碼映射 | 6 |
| `src/server/composition.ts`（改） | `applicationServices().shares` 與獨立的 `shareReadService()` | 6 |
| `src/app/api/documents/[documentId]/share-links/route.ts`（新） | `POST`、`GET` | 7 |
| `src/app/api/share-links/[linkId]/revoke/route.ts`（新） | `POST` | 7 |
| `src/server/share-read.ts`（新） | `/s/:token` 的 read projection | 8 |
| `src/app/s/[token]/page.tsx`（新） | 公開閱讀頁 | 8 |
| `src/app/s/[token]/not-found.tsx`（新） | 統一失效頁 | 8 |
| `next.config.ts`（改） | `/s/:path*` 的回應標頭 | 8 |
| `src/components/actions/action-registry.ts`（改） | `document.share` | 9 |
| `src/components/actions/action-icon.tsx`（改） | `share` 圖示 | 9 |
| `src/components/actions/action-menu.tsx`（改） | `document.open-share` → `kh:request-share` | 9 |
| `src/components/knowledge/share-link-dialog.tsx`（新） | 分享對話框 | 10 |
| `src/components/knowledge/knowledge-layout.tsx`（改） | 掛載對話框 host | 10 |
| `src/components/knowledge/document-header.tsx`（改） | 標頭的 Share link 按鈕 | 10 |
| `tests/e2e/share-link.spec.ts`（新） | E2E | 11 |
| `CLAUDE.md`、Phase 3 spec、`README.md`（改） | 契約修改 | 12 |
| `docs/superpowers/verification/2026-09-23-document-share-link.md`（新） | 驗證紀錄與上線檢查清單 | 12 |

---

### Task 1: Migration 011

**Files:**
- Create: `src/infrastructure/database/mariadb/migrations/011-document-share-links.ts`
- Modify: `src/infrastructure/database/mariadb/migrations/index.ts`
- Test: `tests/integration/share-link-schema.test.ts`

**Interfaces:**
- Produces: `documentShareLinksMigration: Migration`（`version: 11`）

- [ ] **Step 1: 寫失敗測試**

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

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm run test:integration`
Expected: FAIL — `document_share_links` 不存在。

- [ ] **Step 3: 實作**

`011-document-share-links.ts` 依 spec §7.1、§7.2 的 DDL 建立兩張表（`token UUID NOT NULL` + `uq_share_links_token`、兩個 CHECK、`idx_share_links_document`；views 表 PK `(share_link_id, view_date)`）。在 `index.ts` 的 `migrations` 陣列末端加上 `documentShareLinksMigration`。

- [ ] **Step 4: 跑測試確認通過**

Run: `npm run test:integration`
Expected: PASS，既有 migration runner 測試不回歸。

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/database/mariadb/migrations tests/integration/share-link-schema.test.ts
git commit -m "feat(db): migration 011 for document share links"
```

---

### Task 2: Domain 純函式

所有規則在這裡，不含 I/O，讓 spec §5.1、§5.2 的每一條都能單獨被測。

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

`assertShareLinkCreation` 的檢查順序與錯誤：
1. `documentStatus`／`sourceStatus` 非 ACTIVE → `DocumentArchivedError`／`SourceArchivedError`（既有）
2. `workspaceType !== "PERSONAL"` → `ShareLinkNotPersonalError`
3. `personalOwnerUserId !== callerId` → `DocumentNotFoundError`（不洩漏存在）
4. `lifecycleState !== "ACTIVE"` → `WorkspaceArchivedError`（既有，`@/modules/workspaces/domain/errors`）
5. `activeLinkCount >= 10` → `ShareLinkLimitReachedError`
6. `expiresInDays` 不在清單 → `InvalidShareLinkExpiryError`；`undefined` 取預設 30
7. `label` 非字串或 trim 後超過 200 → `InvalidShareLinkLabelError`；空字串正規化為 `null`

`creatorDirectRole` 有讀取權的判斷：`role` 為 `null`（legacy 列）或任一 `ROLE_WORKSPACE_CAPABILITIES[role]` 含 `document.read` 即視為有；`undefined` 為無。

- [ ] **Step 1: 寫失敗測試**

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

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm run test:unit -- tests/unit/share-link-domain.test.ts`
Expected: FAIL — 模組不存在。

- [ ] **Step 3: 實作** `document-share-link.ts`，依上方 Interfaces。`isShareToken` 用 `/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i`。

- [ ] **Step 4: 跑測試確認通過**

Run: `npm run test:unit -- tests/unit/share-link-domain.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/knowledge/domain/document-share-link.ts tests/unit/share-link-domain.test.ts
git commit -m "feat(knowledge): share-link creation and validity rules as pure functions"
```

---

### Task 3: Ports 與 MariaDB repository

**Files:**
- Create: `src/modules/knowledge/ports/document-share-link-repository.ts`、`src/modules/knowledge/ports/share-token-issuer.ts`
- Create: `src/infrastructure/database/mariadb/repositories/document-share-links.ts`、`src/infrastructure/security/random-share-token-issuer.ts`
- Modify: `src/modules/knowledge/ports/unit-of-work.ts`、`src/infrastructure/database/mariadb/repositories/index.ts`
- Test: 由 Task 4、5 的 integration test 覆蓋；本 task 只需 typecheck

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
  revoke(id: string, revokedBy: string, revokedAt: Date): Promise<void>;     // WHERE revoked_at IS NULL；affectedRows 必須為 1
  listDailyViews(linkIds: readonly string[]): Promise<Map<string, ShareLinkDailyViews[]>>;
  recordView(linkId: string, at: Date): Promise<void>;                       // INSERT … ON DUPLICATE KEY UPDATE
}

// ports/share-token-issuer.ts
export interface ShareTokenIssuer { issue(): string } // must return a UUIDv4
```

`KnowledgeRepositories` 加入：

```typescript
  shareLinks: DocumentShareLinkRepository;
  /** Share-link create/revoke append governance events in the same transaction (spec §7.3). */
  auditEvents: WorkspaceAuditEventRepository;
```

`createRepositories()` 已回傳 `auditEvents`；只需加 `shareLinks: new MariaDbDocumentShareLinkRepository(connection)`，並把 `DocumentShareLinkRepository` 加入 `SourceRepositories` 所延伸的型別鏈（若 `SourceRepositories` 以 `KnowledgeRepositories &` 定義則自動涵蓋，否則同步加欄位）。

`recordView` 的 SQL：

```sql
INSERT INTO document_share_link_views (share_link_id, view_date, first_viewed_at, last_viewed_at, view_count)
VALUES (?, DATE(?), ?, ?, 1)
ON DUPLICATE KEY UPDATE last_viewed_at = VALUES(last_viewed_at), view_count = view_count + 1
```

`view_date` 以 UTC 計算：傳入的 `at` 由 service 以 `at.toISOString().slice(0, 10)` 轉為字串後綁定，不依賴連線時區。

`RandomShareTokenIssuer.issue()` 回傳 `randomUUID()`（`node:crypto`）。`src/modules/**` 不得 import 它；只在 composition root 注入。

- [ ] **Step 1: 建立 ports 與型別**，`npm run typecheck` 預期失敗於 `createRepositories` 缺欄位。
- [ ] **Step 2: 實作 repository 與 issuer**，接上 `createRepositories`。
- [ ] **Step 3:** `npm run typecheck && npm run lint` 乾淨。
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

`create` 的步驟（單一 `unitOfWork.run`）：

```text
upsertIdentity(caller.identity)
document = documents.findById(documentId)            → 無：DocumentNotFoundError
source   = sourcePolicy.lockById(document.sourceId)  ← Source FOR UPDATE
workspace = workspaces.lockById(source.workspaceId)  ← Workspace FOR UPDATE
requireMembership(caller, workspace.id)              → 非成員：原樣拋出（映射為 404）
normalized = assertShareLinkCreation({ …, activeLinkCount: shareLinks.countActiveByDocument(documentId, now) })
link = { id: uuidv7(), token: tokens.issue(), … , expiresAt: shareLinkExpiry(now, normalized.expiresInDays) }
if (!isShareToken(link.token)) throw new IntegrityViolationError(…)   ← 防止 issuer 被換成非 v4
shareLinks.insert(link)
auditEvents.append({ eventType: "DOCUMENT_SHARE_LINK_CREATED", targetType: "DOCUMENT_SHARE_LINK", targetId: link.id,
                     workspaceId: workspace.id, actorKind: "USER", actorUserId: caller.identity.id,
                     payload: { documentId, expiresAt: link.expiresAt.toISOString(), label: link.label }, … })
```

`list`：`requireVisibleDocument` 等價檢查（成員且為 PERSONAL 擁有者，否則 `DocumentNotFoundError`），回傳該文件所有連結（含已撤銷、已過期，`active` 旗標區分）與彙總後的檢視數。

`revoke`：`shareLinks.lockById` → 無：`ShareLinkNotFoundError` → document → `Source FOR UPDATE` → `Workspace FOR UPDATE` → `link.createdBy !== caller.identity.id`：`ShareLinkNotFoundError` → 已撤銷：no-op 回傳（冪等）→ `revoke` + audit `DOCUMENT_SHARE_LINK_REVOKED`，payload `{ documentId }`。

> 鎖順序注意：`revoke` 先鎖 link 列再鎖 Source／Workspace。link 表不在 Phase 3 §14.2 的既有路徑中，且沒有其他路徑在持有 Source／Workspace 鎖之後再鎖 link 列，所以不會反轉；若日後有路徑需要這麼做，必須改成先 `findById`（不鎖）取 documentId、鎖 Source → Workspace 後再 `lockById`。

- [ ] **Step 1: 寫失敗測試**（`tests/integration/share-link-service.test.ts`，fixture 仿照 `phase5-authoring-service.test.ts`：以 `PersonalWorkspaceService.ensurePersonalWorkspace` 建立 My Space，`ensureDefaultHubSource` + `HubKnowledgeCommandServiceImpl.createDocument` 建立文件）

必須涵蓋：
  - 擁有者建立 → 回傳 `path` 以 `/s/` 開頭、token 為 UUIDv4、`expiresAt` = 建立時間 + 30 天
  - 連續建立兩條 → 兩個 token 不相鄰（`BigInt` 差值不為 ±1），且都不等於同列 `id` 或 `document_id`
  - 非擁有者（另一使用者）→ `DocumentNotFoundError`，且 `document_share_links` 與 `workspace_audit_events` 沒有新增列
  - Team 文件（擁有者為 Team OWNER）→ `SHARE_LINK_NOT_PERSONAL`，沒有新增列
  - 第 11 條 → `SHARE_LINK_LIMIT_REACHED`；撤銷其中一條後可以再建立
  - `SOURCE_MANAGED` 文件（用 folder import fixture 或直接插入 FOLDER_SYNC source）→ 可以建立
  - audit：一筆 `DOCUMENT_SHARE_LINK_CREATED`，payload 不含 token 字串
  - 原子性：以替身 `auditEvents.append` 丟錯的 unit of work 包裝 → link 也不存在
  - `revoke`：非建立者 → `SHARE_LINK_NOT_FOUND`；重複撤銷 → 不丟錯、只有一筆 REVOKED audit
  - `list`：包含已撤銷的連結且 `active: false`；每條都有 `path`

- [ ] **Step 2: 跑測試確認失敗** — `npm run test:integration`
- [ ] **Step 3: 實作** `create`／`list`／`revoke`
- [ ] **Step 4: 跑測試確認通過** — `npm run test:integration`
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
- Produces: `readShared(token: string): Promise<SharedDocumentView>`；任何失效一律丟 `ShareLinkNotFoundError`

步驟：

```text
if (!isShareToken(token)) throw new ShareLinkNotFoundError()      ← 不查 DB
view = unitOfWork.run(repos => {
  link = shareLinks.findByToken(token)                            → 無：ShareLinkNotFoundError
  document = documents.findById(link.documentId)
  source = sourcePolicy.findById(document.sourceId)
  workspace = workspaces.findById(source.workspaceId)
  membership = workspaceMemberships.find(workspace.id, link.createdBy)
  verdict = evaluateShareLinkValidity({ …, creatorDirectRole: membership ? membership.role ?? null : undefined, now })
  if (!verdict.valid) throw new ShareLinkNotFoundError()
  revision = revisions.findCurrent(document.id)                   → 無：IntegrityViolationError
  creator = users.findById(link.createdBy)
  return { title: revision.title, markdown: revision.markdown, sharedByName: creator.name,
           updatedAt: revision.createdAt, expiresAt: link.expiresAt, linkId: link.id }
})
try { await unitOfWork.run(repos => repos.shareLinks.recordView(view.linkId, now)) }
catch { console.warn("Share link view count was not recorded.") }   ← 不含 token 或 linkId 以外的資訊
return view（去掉 linkId）
```

不呼叫 `users.upsertIdentity`、`workspaceAccess.requireMembership` 或任何接受 `CallerContext` 的方法。

- [ ] **Step 1: 寫失敗測試**，新增：
  - 有效連結 → 回傳目前 revision 的 title／markdown 與擁有者姓名
  - 擁有者 `createRevision` 後再讀 → 回傳新內容（A2）
  - 撤銷後、`expires_at` 以 SQL 改到過去後、文件 `updateStatus("ARCHIVED")` 後、source 封存後、刪除建立者 membership 列後（以 raw SQL）→ 一律 `SHARE_LINK_NOT_FOUND`
  - 格式錯誤的 token → `SHARE_LINK_NOT_FOUND`，且以替身 unit of work 斷言 `run` 未被呼叫
  - 同一天讀三次 → `document_share_link_views` 一列、`view_count = 3`
  - 替身 `recordView` 丟錯 → `readShared` 仍回傳內容
- [ ] **Step 2: 跑測試確認失敗** — `npm run test:integration`
- [ ] **Step 3: 實作**
- [ ] **Step 4: 跑測試確認通過** — `npm run test:integration`
- [ ] **Step 5: Commit**

```bash
git commit -am "feat(knowledge): read a shared document by token without a caller"
```

---

### Task 6: 錯誤映射、composition 與「唯一例外」的掃描測試

**Files:**
- Modify: `src/server/http-error-response.ts`、`src/server/composition.ts`
- Test: `tests/unit/share-link-error-mapping.test.ts`、`tests/unit/share-link-single-exception.test.ts`

**Interfaces:**
- `toWorkspaceErrorResponse`：`SHARE_LINK_NOT_FOUND` 加入 `WORKSPACE_HIDDEN_NOT_FOUND`（404 `NOT_FOUND`）；`SHARE_LINK_NOT_PERSONAL`、`SHARE_LINK_LIMIT_REACHED` → 409；`INVALID_SHARE_LINK_EXPIRY`、`INVALID_SHARE_LINK_LABEL` → 400
- `buildApplicationServices()` 回傳值加上 `shares: new DocumentShareService(unitOfWork, new RandomShareTokenIssuer())`
- 新增 `export function shareReadService(): Pick<DocumentShareService, "readShared">`：只用 `getPool()` 建 `MariaDbUnitOfWork` 與 `DocumentShareService`，**不呼叫** `createIdentityProvider`、`applicationServices()` 或 readiness 檢查；以 `globalThis` slot 快取，`closeApplicationPool()` 一併清除

- [ ] **Step 1: 寫失敗測試**

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

錯誤映射測試仿照 Phase 5 Task 1 的 `phase5-error-mapping.test.ts`，逐碼斷言狀態碼，並斷言 `SHARE_LINK_NOT_FOUND` 的 body code 是 `NOT_FOUND`。

- [ ] **Step 2: 跑測試確認失敗** — `npm run test:unit -- tests/unit/share-link-error-mapping.test.ts tests/unit/share-link-single-exception.test.ts`
- [ ] **Step 3: 實作**
- [ ] **Step 4: 跑測試確認通過**，另跑 `npm run test:unit` 全套確認無回歸
- [ ] **Step 5: Commit**

```bash
git commit -am "feat(server): wire share links, map their errors, and lock the single caller-less path"
```

---

### Task 7: 管理 API

**Files:**
- Create: `src/app/api/documents/[documentId]/share-links/route.ts`、`src/app/api/share-links/[linkId]/revoke/route.ts`
- Test: `tests/integration/share-link-api.test.ts`（仿照 `phase3-workspace-admin-api.test.ts` 直接呼叫 route handler）

**Interfaces:**

| 方法 | 路徑 | Body | 回應 |
| --- | --- | --- | --- |
| `POST` | `/api/documents/:documentId/share-links` | `{ label?: string; expiresInDays?: 1 \| 7 \| 30 \| 90 }` | `201 { link: ShareLinkView }` |
| `GET` | `/api/documents/:documentId/share-links` | — | `200 { links: ShareLinkView[] }` |
| `POST` | `/api/share-links/:linkId/revoke` | — | `204` |

三者都以 `workspace-http.ts` 的既有包裝（`establishTrustedCaller` + `toWorkspaceErrorResponse` + `Cache-Control: private, no-store`）實作。body 不是 JSON 物件 → 400 `INVALID_REQUEST`。

- [ ] **Step 1: 寫失敗測試**：201 回傳的 `link.path` 以 `/s/` 開頭、body 不含 `url`；非擁有者 GET → 404；Team 文件 POST → 409 `SHARE_LINK_NOT_PERSONAL`；`expiresInDays: 2` → 400；revoke → 204，再 GET 該連結 `active: false`
- [ ] **Step 2–4:** 失敗 → 實作 → 通過（`npm run test:integration`）
- [ ] **Step 5: Commit**

```bash
git commit -am "feat(api): create, list and revoke share links"
```

---

### Task 8: 公開閱讀頁 `/s/:token`

**Files:**
- Create: `src/server/share-read.ts`、`src/app/s/[token]/page.tsx`、`src/app/s/[token]/not-found.tsx`
- Modify: `next.config.ts`
- Test: E2E 於 Task 11；本 task 以 `npm run build` 驗證

**Interfaces:**
- `getSharedDocument(token: string): Promise<SharedDocumentView | null>`：呼叫 `shareReadService().readShared(token)`，任何錯誤回 `null`
- `page.tsx`：`export const dynamic = "force-dynamic"`；`null` → `notFound()`；`generateMetadata` 只回傳 `{ title }` 與 `robots: { index: false, follow: false }`，不輸出 `openGraph`／`twitter`
- 內容：標題、`MarkdownRenderer`、一行「由 <sharedByName> 分享 · 最後更新 <Timestamp> · 連結到期 <Timestamp>」；不掛 app shell，不放任何進入 Hub 的連結
- `not-found.tsx`：spec §6.3 的文字

`next.config.ts` 的 `headers()` 追加一筆（保留既有的 `/:path*` CSP）：

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

> `page.tsx` 與 `share-read.ts` 都不得 import `applicationServices` 或 `establishTrustedCaller`。Task 11 的 E2E 在沒有 SSO session reader 的伺服器上開啟連結，任何一處誤用都會讓頁面 500。

- [ ] **Step 1: 實作**
- [ ] **Step 2:** `npm run build && npm run typecheck && npm run lint` 乾淨
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
- `ActionId` 加 `"document.share"`；`ActionIconName` 加 `"share"`（`lucide-react` 的 `Link`）；`ActionCommand` 加 `"document.open-share"`
- 可用條件：`target && context.workspaceType === "PERSONAL" && confirmed && target.status === "ACTIVE" && target.revision === "CURRENT"`。**不看 `target.ownership`、不看 `can.canWrite`。**
- `surfaces: ["palette", "row"]`，排在 `document.favorite` 之前
- `useActionRunner` 的 `document.open-share` → `window.dispatchEvent(new CustomEvent("kh:request-share", { detail: { documentId } }))`

- [ ] **Step 1: 寫失敗測試**（加到既有檔案）

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

- [ ] **Step 2–4:** 失敗 → 實作 → 通過（`npm run test:unit -- tests/unit/action-registry.test.ts`）
- [ ] **Step 5: Commit**

```bash
git commit -am "feat(ui): register the share-link action"
```

---

### Task 10: 分享對話框

**Files:**
- Create: `src/components/knowledge/share-link-dialog.tsx`
- Modify: `src/components/knowledge/knowledge-layout.tsx`、`src/components/knowledge/document-header.tsx`（與傳入它的 page／inspector）

**Interfaces:**
- `ShareLinkDialogHost`：掛在 `KnowledgeLayout`，監聽 `kh:request-share`，以 `detail.documentId` 開啟 `ShareLinkDialog`
- `ShareLinkDialog({ documentId, open, onOpenChange })`：開啟時 `GET` 列表；表單（標籤、期限 `Select` 預設 30）→ `POST`；每條連結顯示標籤、建立／到期（`Timestamp`）、檢視次數、`[複製]`（`navigator.clipboard.writeText(window.location.origin + link.path)`）、`[撤銷]`（兩段式行內確認）；已撤銷／過期的連結收合在「已失效」區
- 說明文字與 spec §4 完全一致
- 撤銷成功 → 既有 toast，無 undo；建立成功不跳 toast
- 文件標頭：PERSONAL 且 ACTIVE、CURRENT 時，從 registry 取 `document.share` 顯示按鈕（與 Edit 並列），點擊 dispatch 同一個事件
- Dialog 以 `@base-ui-components/react/dialog` 實作，結構仿照 `create-team-dialog.tsx`

- [ ] **Step 1: 實作**
- [ ] **Step 2:** `npm run typecheck && npm run lint && npm run test:unit` 乾淨。注意：不在契約內的 Tailwind 拼法（`text-sm`、`rounded-xl`…）**不會報錯，只會編譯成空**，所以 review 時要逐一對照 `frontend-design-language.md`；lint 只擋手寫的 focus ring（要用 `kh-focus-ring`）。
- [ ] **Step 3: Commit**

```bash
git commit -am "feat(ui): share-link dialog from the row menu, palette and document header"
```

---

### Task 11: E2E

**Files:**
- Create: `tests/e2e/share-link.spec.ts`

所有 origin 共用同一個 e2e 資料庫。擁有者操作在 local server（`E2E Knowledge User` 的 My Space）；**匿名檢視在 `phase3UnconfiguredOrigin()`**——那是一個 `company-sso` 但沒有 session reader 的伺服器，任何 `establishTrustedCaller` 都會失敗，正好證明 `/s/` 不依賴登入（spec §6.1 組裝要求）。

- [ ] **Step 1: 寫測試**

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

以上註解是步驟清單；實作時每一步都要寫成實際斷言。

- [ ] **Step 2:** `npm run test:e2e -- tests/e2e/share-link.spec.ts` 通過
- [ ] **Step 3:** `npm run test:e2e` 全套通過
- [ ] **Step 4: Commit**

```bash
git add tests/e2e/share-link.spec.ts
git commit -m "test(e2e): share link from owner to an anonymous reader"
```

---

### Task 12: 契約文件與驗證紀錄

**Files:**
- Modify: `CLAUDE.md`、`docs/superpowers/specs/2026-09-14-phase-3-identity-workspace-governance-design.md`、`README.md`
- Create: `docs/superpowers/verification/2026-09-23-document-share-link.md`

- [ ] **Step 1:** `CLAUDE.md` 的「Knowing an ID is not authorization」改為 spec §3.2 的文字
- [ ] **Step 2:** Phase 3 spec §13 下加入 spec §3.3 的例外段落
- [ ] **Step 3:** `README.md` canonical documents 表加入本 spec 與本 plan
- [ ] **Step 4:** 驗證紀錄：各層測試的實際輸出摘要，以及 spec §15 的上線檢查清單（未勾選，留給部署時填寫）
- [ ] **Step 5:** `make verify` 全綠
- [ ] **Step 6: Commit**

```bash
git commit -am "docs: record the share-link exception in CLAUDE.md and Phase 3"
```

---

## Self-Review

| Spec 條目 | Task |
| --- | --- |
| §3 契約修改 | 12 |
| §5.1 建立條件、ownership 不是條件 | 2、4、9 |
| §5.2 有效性、direct role | 2、5 |
| §5.3 目前版本 | 5、11 |
| §5.4 撤銷、兩段式確認 | 4、10、11 |
| §6.1 唯一入口、組裝要求 | 5、6、8、11 |
| §6.2 不擴散 | 6（掃描）、11（`/w/` 仍需登入） |
| §6.3 統一失效頁 | 8、11 |
| §6.4 回應標頭 | 8、11 |
| §7 資料模型、不存 scope、匿名計數 | 1、3 |
| §8 UUIDv4、非連號 | 2、3、4 |
| §9.3 鎖順序 | 4 |
| §9.4 回傳 path | 7 |
| §10 UI | 9、10 |
| §13 完成判準 | 2、4、5、6、9、11 |
| §15 同步修改文件、上線清單 | 12 |

**§6.2 前兩條（搜尋、selector 不出現分享者的 My Space）** 沒有獨立測試：分享連結不寫入任何 membership 或 capability，這兩條由既有的 Phase 3／Phase 4 授權測試涵蓋，Task 6 的掃描測試保證沒有第二條不經 caller 的讀取路徑。若審查者要求，可在 Task 11 加一個以 phase3 persona 搜尋的斷言。

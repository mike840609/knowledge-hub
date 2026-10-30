# Team Space Publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 將 My Space 資料夾或單篇文件發佈成團隊內的唯讀副本，由各文件的建立者持續更新，團隊成員可閱讀、留言與提及。

**Architecture:** 在 sources 模組新增 `PUBLICATION` 來源、貢獻者與原件配對；所有更新都走同一個依目前狀態進行的 reconciliation。Knowledge 寫入者在原交易記錄事件，sources 在提交後消費，逐一驗證貢獻者權限並投影副本；討論沿用現有 review 系統，新增需要 caller 的團隊範圍與建立者通知。

**Tech Stack:** 現有 Next.js 15 App Router、React 19、TypeScript、MariaDB 手寫 migrations、Vitest、Playwright；使用 npm，不增加 dependencies。

**Spec:** `docs/superpowers/specs/2026-10-30-team-space-publishing-design.md`（已核准的設計；本計劃不重新開啟產品設計）。

## Global Constraints

以下英文條目保留 spec 的原文；每個任務都須滿足：

- “Behind `KM_TEAM_WORKSPACES_ENABLED` (default off), like Team workspaces.”
- “All `CLAUDE.md` invariants hold: scope derived never stored twice, IDs are not authorization, `ACTIVE`/`ARCHIVED` only, every revision writer replaces link edges, the reader never passes HTML.”
- “Publishing and joining re-check, in the application service, that the caller owns the origin (it is in their personal workspace) and holds `source.manage` in the target team.”
- “Knowledge reaches sources only through its `source-policy` port; publication updates travel as domain events recorded in knowledge's own transactions, not as calls into sources.”
- “A team document has exactly one current original.”
- “Only the document creator's originals update a team document.”
- “A non-`NULL` path is reserved to one team document in a publication, even while that document is archived (database constraint).”
- “A team failure never fails or slows the save.”
- “A caller is always required”; 現有匿名 share-read 例外不增加。

Repository 約束：`src/modules/knowledge/**` 不 import sources；modules 不 import Next/React/MariaDB/infrastructure。前端依 `docs/superpowers/specs/frontend-design-language.md` 使用既有 tokens。既有團隊撰寫及匯入的程式與測試保留，入口在 UI 隱藏。領域實體 lifecycle 仍只有 `ACTIVE` / `ARCHIVED`；離開、權限凍結及事件處理進度是另外的欄位。

## Review Focus

1. 同一原件發佈到兩個團隊，一邊失敗不能吞掉另一邊的更新，也不能提早把事件標為完成；Task 7 驗證逐目的地進度及重試。
2. group-only 成員在無 caller 時無法判權；必須 pending，不能假造 caller、凍結或清除既有凍結原因；Tasks 5、7、8 驗證。
3. rename 的 swap/rotation、移到自己的封存路徑、舊原件被重新掛接後又還原，都必須保留既定建立者與討論；Tasks 1、5 驗證。
4. 建立者或被提及者被移出團隊後，Inbox 的列表、計數、連結與 mark-read/hide 都須重新判權；Task 10 驗證不洩漏及重新加入後恢復。
5. EDITOR/ADMIN 直接呼叫既有 projection、source lifecycle、revision、icon、tree 或 import 入口都不能改寫 publication；Task 3 驗證完整封鎖面。

---

## Execution Context and File Structure

工作目錄：`/Users/chuntsai/Projects/km-wt-4`，分支：`docs/team-space-publishing`。開始執行前再次確認 `git status --short --branch`；這份計劃在規劃開始前已是未追蹤草稿，本次在原路徑補寫。只規劃，尚未執行 migrations、測試或功能實作。

已確認的整合點：

- migration 最新為 `029-review-comment-mentions.ts`，下一版使用 `030-team-publications.ts`；真實來源及文件表是 `knowledge_sources` / `knowledge_documents`。
- `SourceRepositories` 繼承 `KnowledgeRepositories`；兩者共用 `MariaDbUnitOfWork`，新事件 port 可加入現有交易。
- `bindSourceProjection` 在 `source-knowledge-projection-service.ts`，目前要求非空 `SourceMappingInput.sourcePath` 與 `source_entries`。不能直接用它表示沒有路徑的 Hub 副本，也不能傳入假路徑。
- link catalog 和 search 的 path filter 直接查 `source_entries`；publication 自有路徑表須接入這些 adapter，不能只新增 domain type。
- `share_comment_events.origin_share_link_id` 與 `review_comment_mentions.share_link_id` 目前都是 NOT NULL；團隊通知、提及必須允許無分享連結。
- 現有 revision writer guard 明列三個檔案，包含 `insertMany`；沿用該三個 writer，維持每筆 revision 的 link replacement/indexing。
- npm integration runner `scripts/test/integration.ts` 會建立、migrate、清理隔離 DB；使用 `npm run test:integration -- <file>`，不要直接對開發 DB 跑 Vitest。

| 檔案或區域 | 責任 |
|---|---|
| `src/modules/sources/domain/publication.ts` | Publication、Contribution、DocumentBinding 型別與純 placement 規則 |
| `src/modules/sources/ports/publication-repository.ts` | 發佈、配對、原件 claim、path reservation 與 delivery 持久化 |
| `src/modules/knowledge/ports/publication-event-repository.ts` | 原交易寫入事件的 knowledge port |
| `src/infrastructure/database/mariadb/migrations/030-team-publications.ts` | 所有新資料表、唯一約束及通知欄位調整 |
| `src/infrastructure/database/mariadb/repositories/publications.ts` | PublicationRepository adapter |
| `src/infrastructure/database/mariadb/repositories/publication-events.ts` | Knowledge event port adapter |
| `src/modules/sources/application/publication-{service,reconciler,drain}.ts` | 使用者操作、單一更新演算法、事件消費 |
| `src/modules/sources/application/source-knowledge-projection-service.ts` | 沿用 revision writer，增加僅供 publication 的投影綁定 |
| `src/modules/knowledge/application/internal/*.ts` | 原件內容、位置、lifecycle 交易內事件 |
| `src/server/publication-post-commit.ts` | 回應後排程、caller 捕獲、錯誤隔離 |
| `scripts/db/catch-up-publications.ts` | flag 重新開啟後的無 caller 修復 |
| `src/modules/knowledge/application/document-review-service.ts` | 團隊討論 scope；需要時拆出 notification 判權 helper，避免擴張巨型檔案 |
| `src/app/api/publications/**` | 發佈操作與預覽的薄 routes |
| `src/components/publications/**` | 發佈/加入 dialog、維護者標示、生命週期選單 |
| `tests/integration/fixtures/publications.ts` | 兩位建立者、direct/group 成員、多團隊、Folder Sync/Hub 原件共用 fixtures |

功能屬於同一條端到端流程；按下列任務順序落地。每個任務都有自己的測試及 commit，不另拆成無法交付的 schema-only 專案。

### Task 1: 定義配對、path 與貢獻者狀態規則

**Files:** Create `src/modules/sources/domain/publication.ts`; Test `tests/unit/publication-domain.test.ts`.

**Interfaces:** 此任務定義後續共用的型別與函式：

```ts
export type PublicationKind = "FOLDER" | "DOCUMENT";
export type Publication = { id: string; sourceId: string; teamWorkspaceId: string;
  name: string; kind: PublicationKind; creatorUserId: string; status: "ACTIVE" | "ARCHIVED" };
export type PublishOrigin = { kind: "FOLDER"; folderNodeId: string }
  | { kind: "DOCUMENT"; documentId: string };
export type Contribution = { id: string; publicationId: string; userId: string;
  origin: PublishOrigin; leftAt: Date | null; rightsFrozenAt: Date | null; pendingCatchUp: boolean };
export type PublicationDocument = { teamDocumentId: string; publicationId: string;
  creatorContributionId: string; currentOriginalDocumentId: string;
  sourcePath: string | null; status: "ACTIVE" | "ARCHIVED" };
export type DocumentBinding = { contributionId: string; originalDocumentId: string;
  teamDocumentId: string };
export type RightsJudge = { kind: "CALLER"; caller: CallerContext } | { kind: "NO_CALLER" };
export type ReconcileReport = { created: number; updated: number; moved: number;
  archived: number; restored: number; notices: PublicationNotice[] };
export type PublicationNotice = { publicationId: string; originalDocumentId: string;
  code: "MAINTAINED_BY_OTHER" | "PATH_RESERVED" | "ORIGINAL_ALREADY_PUBLISHED";
  maintainerUserId?: string; existingPublicationName?: string };
export type PlannedMove = { teamDocumentId: string; fromPath: string | null; toPath: string | null };
export function normalizePublicationName(raw: string): string;
export function relativePublicationPath(sourcePath: string | null, rootPath: string): string | null;
export function planPublicationMoves(moves: readonly PlannedMove[],
  held: ReadonlyMap<string, PublicationDocument>): { applied: PlannedMove[]; blocked: PlannedMove[] };
export function publicationOverlap(originPaths: readonly string[], teamPaths: readonly string[]): number;
```

`CallerContext` 直接 import identity domain。`teamWorkspaceId/name/status` 是 repository JOIN 後的 view，並非 publication 表中重存 scope/lifecycle。`PublicationDocument.status` 來自 `knowledge_documents`。離開、rights freeze、pending 分開存，不能用單一 enum 覆蓋彼此。

- [ ] **Step 1 — 寫失敗測試。** 名稱 trim，長度沿用 `MAX_FOLDER_NAME_LENGTH = 512`，不自動加 suffix；空白或 513 字元丟 `ValidationError`。測試名 `relative paths require a segment boundary` 斷言 `relativePublicationPath("docs/a.md", "docs") === "a.md"`、`("docs2/a.md", "docs") === null`、Hub `null === null`。資格是否在資料夾內由 tree ancestry 判斷，不把 `null` 同時當作資格判斷。
- [ ] **Step 2 — 寫 move 與 overlap 測試。** `swap`、三方 `rotation` 全部 applied；多個 move 競爭同一最終 path 或撞上不移動的 holder 則 blocked，且被擋而留在原處的文件會繼續擋住依賴它的 move。`publicationOverlap(["a.md","b.md"],["a.md"]) === 0.5`；空路徑集合為 0，不建議 join。
- [ ] **Step 3 — 驗證失敗。** `npm run test:unit -- tests/unit/publication-domain.test.ts` → 新函式缺失而 FAIL。
- [ ] **Step 4 — 實作純規則。** path 保持大小寫與原始 segment，比對不用 title normalization；moves 反覆剔除衝突直到 final state 穩定，保留合法 cycles。suggestion 門檻為 `>= 0.5`，join 警告 `< 0.5`；零個 synced path 不提供 join suggestion。
- [ ] **Step 5 — 驗證及提交。** 同一指令 PASS；`git add src/modules/sources/domain/publication.ts tests/unit/publication-domain.test.ts`，commit `feat(sources): define publication matching rules`。

### Task 2: Schema、持久化與可追蹤的事件進度

**Files:** Create migration `030-team-publications.ts`, repositories `publications.ts` / `publication-events.ts`（上述完整目錄）及兩個新 ports；Modify migrations/repositories 的 `index.ts`、knowledge/sources `ports/unit-of-work.ts`、knowledge `domain/source-policy.ts`; Create `tests/integration/fixtures/publications.ts`, `tests/integration/publication-persistence.test.ts`.

**Consumes:** Task 1 domain types。**Produces:** `SOURCE_TYPES` 增加 `PUBLICATION`，ownership 為 `SOURCE_MANAGED`；兩個 adapter 由 `createRepositories` 在同一連線建立。Unit-of-work 新增 `publicationEvents`，SourceRepositories 另有 `publications`。

Schema 固定如下，時間與 actor/FK 欄位依既有 migration 慣例補全：

- `publications(id PK, source_id UNIQUE FK, kind, creator_user_id FK)`；名稱、workspace、status 均 JOIN `knowledge_sources`。
- `knowledge_sources.active_publication_name`：與 `name` 相同的 512 字元 binary collation generated column，只有 `source_type='PUBLICATION' AND status='ACTIVE'` 時為 name，其他為 NULL；`UNIQUE(workspace_id, active_publication_name)`。更新既有 `ck_sources_type_ownership`，不能改舊 migration。
- `publication_contributors(id PK, publication_id FK, user_id FK, origin_folder_node_id NULL FK, origin_document_id NULL FK, left_at NULL, rights_frozen_at NULL, pending_catch_up)`；`UNIQUE(publication_id,user_id)`，origin 恰有一個非 NULL。單篇只能有第一位貢獻者，由 service 在鎖內驗證。
- `publication_documents(team_document_id PK FK, publication_id FK, creator_contribution_id FK, current_original_document_id FK, source_path TEXT utf8mb4_bin NULL, path_hash BINARY(32) generated from SHA2(source_path,256))`；`UNIQUE(publication_id,path_hash)`，包含已封存文件；NULL 不保留位置。adapter 查 hash 後再作 binary path 比較，不能把 hash 碰撞當成同一文件。
- `publication_bindings(contribution_id FK, original_document_id FK, team_document_id FK, active_team_workspace_id UUID NULL, PRIMARY KEY(contribution_id,original_document_id), UNIQUE(original_document_id,active_team_workspace_id))`。建立者及非建立者都存配對並 claim；active key 由來源 JOIN 得到且僅在 publication ACTIVE 時填入，是唯一約束用的 claim key，不能拿來授權。archive 清空、restore 在同一交易重新 claim。重新掛接必須移除舊建立者原件的 binding，讓舊原件停止供應。
- `publication_events(id PK, document_id NULL FK, tree_node_id NULL FK, kind, revision_id NULL FK, created_at, consumed_at NULL)`；至少一個 target 非 NULL。kind 為 `REVISION` / `TREE` / `LIFECYCLE` / `SOURCE`。事件的 workspace 由 target→source 推導；保留 source 級事件以涵蓋整個原來源的 archive/restore。
- `publication_event_deliveries(event_id FK, contribution_id FK, PRIMARY KEY(event_id,contribution_id), processed_at NULL, outcome NULL)`；每個目標各自完成，pending/失敗不能讓根事件 consumed。無目標或明確跳過 LEFT/封存 publication 可完成；flag off 時完全不消費。
- `publication_reconcile_reports(contribution_id PK FK, report_json, updated_at)`：保存最近一次 notices，讓非同步 apply 結果可讀取。
- `share_comment_events` 增加 `recipient_user_id UUID NULL FK`、把 `origin_share_link_id` 改成 nullable；`review_comment_mentions.share_link_id` 改 nullable。NULL 只用於團隊 publication，service 及 adapter 驗證 context，不產生匿名 grant。

Ports 的方法固定為：

```ts
interface PublicationEventRepository {
  record(event: { documentId: string | null; treeNodeId: string | null;
    kind: "REVISION" | "TREE" | "LIFECYCLE" | "SOURCE";
    revisionId?: string | null; at: Date }): Promise<void>;
  recordMany(events: readonly Parameters<PublicationEventRepository["record"]>[0][]): Promise<void>;
}
interface PublicationRepository {
  findById(id: string): Promise<Publication | null>;
  findBySourceId(sourceId: string): Promise<Publication | null>;
  listByTeam(teamId: string, includeArchived?: boolean): Promise<Publication[]>;
  insert(publication: Publication): Promise<void>;
  listContributions(publicationId: string): Promise<Contribution[]>;
  listByContributor(userId: string): Promise<Contribution[]>;
  insertContribution(contribution: Contribution): Promise<void>;
  setContributionState(id: string, state: Pick<Contribution,"leftAt" | "rightsFrozenAt" | "pendingCatchUp">): Promise<void>;
  listDocuments(publicationId: string): Promise<PublicationDocument[]>;
  listBindings(contributionId: string): Promise<DocumentBinding[]>;
  bind(binding: DocumentBinding): Promise<void>;
  repoint(teamDocumentId: string, originalDocumentId: string): Promise<void>;
  insertDocument(document: PublicationDocument): Promise<void>;
  applyPaths(moves: readonly PlannedMove[]): Promise<void>;
  setPublicationStatus(publicationId: string, status: "ACTIVE" | "ARCHIVED", actorId: string): Promise<void>;
  listPendingEvents(userId?: string, limit?: number): Promise<{ eventId: string; contributionId: string }[]>;
  completeDelivery(eventId: string, contributionId: string, outcome: "APPLIED" | "SKIPPED"): Promise<void>;
  saveReport(contributionId: string, report: ReconcileReport): Promise<void>;
  findReport(contributionId: string): Promise<ReconcileReport | null>;
}
```

`bind/repoint/setPublicationStatus` 原子維護 claims，duplicate key 轉為具名 domain error。`applyPaths` 在持有 publication Source 鎖的交易中先暫清 applied 文件的 path，再寫入 final paths；不能因唯一 index 的逐列檢查而讓合法 swap 失敗。新增 integration fixture `createPublicationFixture()`，回傳 `uow`、`pool`、Mike/Ann 的 trusted callers 與 personal workspace、direct/group team IDs，並提供以公開服務建立 Hub / Folder Sync 原件的 helpers；不用繞過 application 判權。

- [ ] **Step 1 — 寫失敗測試。** `rejects duplicate active names but releases on archive`；`claims joiner originals as well as creator originals`；`reserves archived paths; accepts multiple NULL paths`；`keeps path case distinct and accepts paths longer than 512`；`repoint releases the old original and replaces the creator binding`；`one delivery completing leaves the root event unconsumed while another is pending`；`nullable link fields round-trip without becoming string "null"`。以 `expect(...).rejects`、`expect(rows).toHaveLength(...)` 明確驗證 DB constraint 和 repository round-trip。
- [ ] **Step 2 — 驗證失敗。** `npm run test:integration -- tests/integration/publication-persistence.test.ts` → 新表缺失而 FAIL（MariaDB 未啟動則先 `make db-up`）。
- [ ] **Step 3 — 實作 migration 及 adapters。** FK 用 `ON DELETE RESTRICT`；events、deliveries 加未消費查詢索引；禁止同一 document 指到不同 publication 的資料形狀，透過 adapter 鎖內檢查驗證 Source/Workspace 關係。調整 test repositories/mocks 以符合新增 UoW port。
- [ ] **Step 4 — 驗證及提交。** 同一 integration 指令 PASS，`npm run typecheck` PASS。提交上述明列檔案，commit `feat(db): persist publications and delivery progress`。

### Task 3: 唯讀封鎖與 publication 專用投影

**Files:** Modify `src/modules/sources/application/source-knowledge-projection-service.ts`, `source-version-guard.ts`, `create-folder-import.ts`, `apply-folder-import.ts`, `src/modules/knowledge/application/internal/tree-transaction.ts`; Create `src/modules/sources/application/publication-write-authority.ts`; Test `tests/integration/publication-lock.test.ts`, `publication-projection.test.ts`.

**Consumes:** Tasks 1–2。**Produces:** 只在 sources 內使用的新綁定：

```ts
export async function bindPublicationProjection(r: SourceRepositories, input: {
  publicationId: string; contributionId: string; judge: RightsJudge;
}): Promise<PublicationProjection>;
export interface PublicationProjection {
  copy(input: { originalDocumentId: string; parentId: string | null;
    nodeName: string; sourcePath: string | null }): Promise<{ documentId: string; treeNodeId: string }>;
  refresh(teamDocumentId: string, originalDocumentId: string): Promise<{ changed: boolean }>;
  place(input: { teamDocumentId: string; parentId: string | null; nodeName: string }): Promise<void>;
  setDocumentStatus(teamDocumentId: string, status: "ACTIVE" | "ARCHIVED"): Promise<void>;
  ensureFolder(parentId: string | null, name: string): Promise<string>;
  pruneEmptyFolders(): Promise<void>;
}
```

Binding 從鎖內讀取 publication/contribution，以 Task 5 的規則判權；authority 為內部 opaque 型別，僅 binder 建立。團隊文件 createdBy/updatedBy 與 revisions.createdBy 都記 document creator，不記 worker、admin restorer 或 joiner。`NO_CALLER` 讀 direct membership；不能組裝假的 `CallerContext` 或開 `force/isSync` 參數。

- [ ] **Step 1 — 寫失敗測試。** `copy preserves title markdown metadata and replaces link edges`、`equal hash writes no revision`、`Hub copy uses NULL path without source_entries row`、`caller-less copy requires a direct source.manage grant`。測試 `expect(teamRevision.createdBy).toBe(mike.identity.id)`、`expect(teamPath).toBeNull()`。
- [ ] **Step 2 — 寫封鎖矩陣。** EDITOR、ADMIN 直接呼叫 Hub create/revise/duplicate/restore revision、create folder、move/reorder/rename、archive/restore document/folder、set icon、generic source archive/restore/rename、known-entry apply/archive、generic `bindSourceProjection`（含 hints fast path）、import create/apply 到 PUBLICATION 均拒絕，資料與 revision 數不變。publication 生命周期另走 Task 8；保留既有普通 team source 行為與測試。
- [ ] **Step 3 — 驗證失敗。** `npm run test:integration -- tests/integration/publication-projection.test.ts tests/integration/publication-lock.test.ts` → FAIL。
- [ ] **Step 4 — 實作。** 在現有 projection writer 檔案內抽共用 canonical writes，沿用同一 revision insert/link-index 分支，新 binder 提供經判權的 creator actor。原有 binder 的普通與 hints 路徑均拒絕 PUBLICATION。Hub 的 SOURCE_MANAGED 拒寫機制繼續成立；所有 publication 專用寫入都在既有 UoW 中，不巢狀開交易。來源 entry 的非空路徑約束保持；publication 路徑寫 Task 2 的表。
- [ ] **Step 5 — 驗證及提交。** 上述 integration + `npm run test:unit -- tests/unit/link-index-write-points.test.ts` + `npm run lint` PASS；commit `feat(sources): isolate publication projection authority`。

### Task 4: 完整記錄原件內容、位置及生命周期事件

**Files:** Modify knowledge `application/internal/{create-document,create-revision,move-tree-node,rename-folder,set-document-lifecycle,set-folder-lifecycle}.ts`; sources `application/{source-knowledge-projection-service,source-entry-mapping-service,source-import-plan-executor,source-version-guard}.ts`; Create `tests/unit/publication-event-write-points.test.ts`, `tests/integration/publication-events.test.ts`.

**Consumes:** `repositories.publicationEvents.record/recordMany`。**Produces:** 每筆個人 revision 記錄它的 ID；tree/folder mutation 記 target，consumer 擴展受影響 descendants。bulk revision 用 `recordMany`；path-only 的 source entry 更新、同步 archive/restore，以及整個個人 Source archive/restore 都有事件。

- [ ] **Step 1 — 寫 guard 測試。** 沿用 link guard 的三個 revision writers（含 `insertMany`），驗證對應 `record/recordMany`；再明列 tree/lifecycle 六個 knowledge internals 與 sources 的 locator/lifecycle 寫入點。guard 同時盤點 `.revisions.insert(Many)?`、tree parent/name/status、document status、entry sourcePath/lifecycle 及 source lifecycle，避免僅掃 revisions 漏掉沒有新 revision 的 rename。重複事件可接受，遺漏不可接受。
- [ ] **Step 2 — 寫 integration 測試。** `rollback leaves neither revision nor event` 斷言兩者數目都不變；`same hash saves no new revision event`；bulk N 份文件有 N 個 revision IDs；`path-only sync rename emits an event`；`folder move/archive and source archive emit events covering descendants`；`projected team copies never emit personal publication events`。
- [ ] **Step 3 — 驗證失敗。** `npm run test:unit -- tests/unit/publication-event-write-points.test.ts`；`npm run test:integration -- tests/integration/publication-events.test.ts` → FAIL。
- [ ] **Step 4 — 實作交易內記錄。** knowledge 只呼叫自己的 event port；以同一連線查出的 source→workspace 判斷 PERSONAL。source 級事件用該 Source 的 root tree node 作 target；若沒有 tree 節點即沒有可發佈的原件，不需事件。consumer 只看目前狀態，事件 payload 不當更新內容。
- [ ] **Step 5 — 驗證及提交。** 上述兩個指令與 link-index guard PASS；commit `feat(knowledge): record publication changes transactionally`。

### Task 5: 單一 reconciliation 演算法

**Files:** Create `src/modules/sources/application/publication-reconciler.ts`; Modify `publication-write-authority.ts`; Test `tests/integration/publication-reconcile.test.ts`.

**Consumes:** Tasks 1–4。**Produces:**

```ts
export async function reconcileContribution(r: SourceRepositories, input: {
  publicationId: string; contributionId: string; judge: RightsJudge; now: Date;
}): Promise<{ state: "APPLIED" | "FROZEN" | "PENDING" | "SKIPPED"; report: ReconcileReport }>;
```

判權：CALLER 只能代表相同 contributor user；使用 `evaluateWorkspaceCapabilities` 含 caller 的 validated groups。active team + `source.manage` 才 apply，失敗記 rights freeze。NO_CALLER 只允許 active team 的 direct role（`ROLE_WORKSPACE_CAPABILITIES`），無法證明時 pending；已有 rights freeze 不被 NO_CALLER 清除。LEFT 和封存 publication 跳過。原件仍須在該 user 的 PERSONAL workspace；eligible 由 source/document/tree/祖先 ACTIVE 及 folder ancestry 一起判斷。單篇沒有 path，不要求原件仍在原資料夾。

- [ ] **Step 1 — 寫失敗測試。** `creator revision fans out without duplicate revisions`；`creator rename follows persisted original id`；`non-creator rename stays bound and cannot create or overwrite`；`new path creates one creator`；`same-path concurrent arrivals leave one document and the loser non-creator`；`Hub documents with equal names remain distinct with NULL paths`。
- [ ] **Step 2 — 寫 path/lifecycle 測試。** 以原件 ID、team ID、threads ID 斷言：另一建立者的 active/archived path 都擋住 move；自己的 archived path 會重用舊 team ID、保留 threads、更新 current original；incoming original 原本供應的另一 team copy archive 並保留舊 path；舊原件還原不得重新餵同一 team document；swap/rotation 在同一 sync 全數成功；最終仍衝突時維持原 team path 並回 `PATH_RESERVED`。任何 contentHash 不變的 move 都 `expect(revisionCountAfter).toBe(revisionCountBefore)`。
- [ ] **Step 3 — 補資格與 rights 測試。** folder 原件移出/archived/來源 archived → copy archive；移回/restore → 恢復；新 Hub 原件依 personal tree 的相對 folder names 放置；空 projection folder archive；group-only CALLER 成功、NO_CALLER pending；rights-frozen 只有本人成功操作解凍並全面 reconcile；LEFT 不被普通 save/catch-up 啟動。
- [ ] **Step 4 — 驗證失敗。** `npm run test:integration -- tests/integration/publication-reconcile.test.ts` → FAIL。
- [ ] **Step 5 — 實作。** 先列完整原件與持久配對、計算 final placement，再套用。已配對的非建立者一律只出 notice；未配對才依 publication-relative path 找 holder，NULL 則各自建立。先恢復/重新掛接自己的 archived holder，再處理合法 move 集合；claims、paths、tree、revisions、links 與 report 同一交易提交。根據原件目前資料決定，不根據事件新舊覆蓋。repoint 刪除舊 creator binding，但保留其他 contributor 的配對。
- [ ] **Step 6 — 驗證及提交。** 同一指令 PASS；second reconciliation 沒有資料變動及新 revision（report 的既有 notices 可保留）。commit `feat(sources): reconcile publication documents from current originals`。

### Task 6: Publish、join、leave、resume

**Files:** Create `src/modules/sources/application/publication-service.ts`; Test `tests/integration/publication-service.test.ts`.

**Consumes:** Tasks 1–5。**Produces:** `PublicationService(uow: SourceUnitOfWork)`：

```ts
preview(caller: CallerContext, input: { teamWorkspaceId: string; name: string;
  origin: PublishOrigin }): Promise<PublishPreview>;
publish(caller: CallerContext, input: { teamWorkspaceId: string; name: string;
  origin: PublishOrigin }): Promise<{ publicationId: string; report: ReconcileReport }>;
join(caller: CallerContext, input: { publicationId: string; folderNodeId: string;
  acknowledgeLowOverlap?: boolean }): Promise<{ contributionId: string; report: ReconcileReport }>;
leave(caller: CallerContext, publicationId: string): Promise<void>;
resume(caller: CallerContext, publicationId: string): Promise<ReconcileReport>;
```

`PublishPreview` 為 `{ nameTaken: boolean; refusedOriginals: { documentId: string; publicationName: string }[]; joinSuggestion: { publicationId: string; name: string; overlap: number } | null; lowOverlapWarning: boolean }`。preview 讀取不寫入。publish/join 在提交交易中重新判 ownership/capabilities、重算重疊與 claims；preview 不能授權。強 overlap 只建議，使用者仍可新建。

- [ ] **Step 1 — 寫失敗測試。** My Space folder 和 single document happy paths；他人的 origin → not found；VIEWER → denied；兩個併發同名 publish 只有一個成功；name 預設由 UI 填入 origin 名稱，空名仍拒絕；preview `nameTaken === true` 卻零寫入；overlap 0.5 建議 join；DOCUMENT publication 禁止 join。
- [ ] **Step 2 — 寫 claim 與退出測試。** 同一原件在同一團隊被 folder `/a`、`/a/b` 或 single-document 交疊發佈，回既有 publication 名稱；排除衝突原件、其餘仍可發佈，若全部衝突則不建立空 publication。相同原件跨兩隊可發佈。Ann join 的新版不能覆寫 Mike，`report.notices[0].code === "MAINTAINED_BY_OTHER"`；新 path 的 creator 是 Ann；LEFT 的 claims 仍占用；resume 僅本人且全面 reconcile。重複 join 不重綁 origin、回既有 contribution；換 origin 需拒絕，避免暗中取代原件。
- [ ] **Step 3 — 驗證失敗。** `npm run test:integration -- tests/integration/publication-service.test.ts` → FAIL。
- [ ] **Step 4 — 實作。** publish 在 team source、publication、第一位 contribution 與 copies 的同一交易完成。以 active-name/claim DB 約束處理 races，重讀後轉具名錯誤或 notice；不自動 suffix。join 的低 overlap 要求明確 acknowledgment 才寫入；leave 保留配對及文件，resume 清 leftAt 但只有 rights pass 才 reconcile。
- [ ] **Step 5 — 驗證及提交。** 同一指令 PASS；commit `feat(sources): publish and join personal knowledge into teams`。

### Task 7: 事件 drain、回應後排程、preview/result notices

**Files:** Create `src/modules/sources/application/publication-drain.ts`, `src/server/publication-post-commit.ts`; Modify `src/server/composition.ts`, sources `application/{get-folder-import-preview,reconcile-import-snapshot,apply-folder-import}.ts`, `domain/import-diff.ts`（僅必要的 notice 型別）；Test `tests/integration/publication-drain.test.ts`, `tests/unit/publication-post-commit.test.ts`.

**Consumes:** Task 5 reconciler。**Produces:**

```ts
export async function drainPublicationEvents(uow: SourceUnitOfWork, input: {
  judge: RightsJudge; limit?: number;
}): Promise<{ applied: number; pending: number; frozen: number; failed: number }>;
export function schedulePublicationDrain(caller: CallerContext): void;
```

CALLER drain 只處理本人所有 contributions，包含 pending 及既有 rights freeze。NO_CALLER worker 逐 direct member 處理，group-only 保留 pending。來源交易成功且釋放鎖後才排程；`src/server` 的 helper 用本 repo Next 匯出的 `after`，捕獲經驗證 caller（含 group IDs），回應先送出。不是 bare fire-and-forget，也不 `await` team reconciliation 才回應。非 HTTP 執行者可明確 await drain，或使用 Task 8 修復腳本。

- [ ] **Step 1 — 寫失敗測試。** 同一原件發兩隊，第一隊 apply、第二隊注入故障 → event 仍 unconsumed，第一隊 delivery 完成；重試不重複 revision，第二隊追上後才 consumed。late/repeated events 不退回舊 revision；事件處理與 consume 同一交易 rollback；若新事件在 batch 執行中插入，下一輪仍可見。
- [ ] **Step 2 — 寫排程與 flag 測試。** 尚未 resolve 的 drain 不阻擋原 Hub save/import response；drain throw 只被 log，原件已成功且 event 留著；off → 不排程、不 consumed、不改 freeze；rollback → 不排程。本人下一次 no-op save/sync 仍觸發 pending/full reconcile，避免必須改內容才可恢復。
- [ ] **Step 3 — 寫結果測試。** Ann sync 的 preview 與結果都含 Mike 的維護者 notice；creator move 撞上保留 path 時，original sync 仍成功且 team copy path 不變、report 有 `PATH_RESERVED`。preview 以 proposed final originals 計算；最終 reconciliation report 由 Task 11 的 GET 結果端點讀取。不得將其他團隊的 publication 名稱/維護者洩漏給已失去 access 的 contributor。
- [ ] **Step 4 — 驗證失敗。** `npm run test:unit -- tests/unit/publication-post-commit.test.ts`；`npm run test:integration -- tests/integration/publication-drain.test.ts` → FAIL。
- [ ] **Step 5 — 實作 drain。** 先發現 events 的目標 contributions，逐目標 transaction，完成後才標記 delivery；pending/錯誤不確認根 event。batch 預設 100，直到本次上限結束，未處理項保持可見。以 contributor 聚合同批內容、位置及 lifecycle，讓同一 sync 的 swap 一起求解。排程只覆蓋真正 mutate 的 hub 命令（含 duplicate、tree/lifecycle）、sources known-entry 及 `imports.apply`；`finalize` 只建 snapshot，不更新原件，故不 drain。
- [ ] **Step 6 — 驗證及提交。** 上述指令 PASS；commit `feat(sources): deliver publication events after personal saves`。

### Task 8: Unpublish、restore、rename 與無 caller catch-up

**Files:** Modify `publication-service.ts`; Create `scripts/db/catch-up-publications.ts`; Modify `package.json`, `Makefile`, `docs/operations/team-workspaces-availability{,.zh-TW}.md`; Test `tests/integration/publication-lifecycle.test.ts`, `publication-catch-up.test.ts`.

**Consumes:** Tasks 5、7。**Produces:** `PublicationService.unpublish(caller, publicationId): Promise<void>`, `.restore(caller, publicationId): Promise<void>`, `.rename(caller, publicationId, name): Promise<void>`。Admin 以 caller 的 effective `membership.manage_basic` 判斷（OWNER/ADMIN，含 groups）；publication creator 則需要 `source.manage` 且未 LEFT。三者不能僅以 createdBy 判權。

- [ ] **Step 1 — 寫失敗測試。** creator unpublish 封存整個 source（joiners 一起不可見）、釋放 active name 和所有 claims，但保留文件/討論/path reservation；creator LEFT 後不能操作，effective group ADMIN 能操作；原 contributor save/catch-up 不會還原 source。rename 沿用 `renameSource` 的 canonical name mutation 邏輯，經 publication 授權入口，無新 revision；撞 active name 回 `PUBLICATION_NAME_TAKEN`。
- [ ] **Step 2 — 寫 restore/catch-up 測試。** name 或任一 original 被新 publication 取用，restore 全部 rollback，分別 `PUBLICATION_NAME_TAKEN` / `PUBLICATION_ORIGINAL_TAKEN`；成功時重新 claim，non-left/non-frozen direct contributors 全面 reconcile，其餘 pending。off 期間新原件、內容、move、archive/source archive 在 catch-up 後全部反映；LEFT、rights-frozen、unpublished/admin-archived 不自動恢復。
- [ ] **Step 3 — 驗證失敗。** `npm run test:integration -- tests/integration/publication-lifecycle.test.ts tests/integration/publication-catch-up.test.ts` → FAIL。
- [ ] **Step 4 — 實作修復腳本與操作。** 增 `db:catch-up-publications` npm script、`db-catch-up-publications` make target。flag off 時明確輸出 skipped，無寫入；on 時先 drain，再掃所有 active contributions（不能只靠有無 event），NO_CALLER 規則不清除 rights freeze。輸出 `applied=<n> pending=<n> skipped=<n> failed=<n>`，有 failed exit 1，其餘 0，可安全重跑；操作文件記錄開旗標→catch-up→pending 需本人 save/sync 的流程。
- [ ] **Step 5 — 驗證及提交。** 同一指令和既有 `phase3-team-governance.test.ts` PASS；commit `feat(sources): manage publication lifecycle and catch-up`。

### Task 9: 團隊 review scope、通知與無連結 mention

**Files:** Modify knowledge `application/document-review-service.ts`, `domain/{share-comment-event,review-mention}.ts`, `ports/source-policy.ts`, `ports/share-comment-event-repository.ts`; MariaDB `repositories/{source-policy,share-comment-events,review-mentions}.ts`; existing `src/app/api/documents/[documentId]/review-threads/**` and `src/app/api/review-mentions/candidates/route.ts`; Test `tests/integration/publication-review.test.ts`.

**Consumes:** Publication document metadata。**Produces:** source-policy 唯讀 port 新增 `findPublicationDocument(documentId): Promise<{ creatorUserId: string; publicationId: string; sourcePath: string | null } | null>`；由 sources adapter JOIN 回答，Knowledge 不 import sources。`queryForOwner` 保留方法/route 名，回傳新增 `ownerUserId`, `canModerate`；其餘 query payload 保持相容。

- [ ] **Step 1 — 寫失敗測試。** TEAM PUBLICATION 的 direct/group members（含既有 VIEWER）可讀及留言，非成員相同 not found；creator/admin 可 hide，普通 member 不可；member 只可 edit/delete 自己的 comment；hidden bodies 不傳給無 moderation 權限成員。只有 creator 收 owner event，自己留言不通知自己；Ann 留言、第三人回覆，不會自動 follow Ann。
- [ ] **Step 2 — 寫 mention 測試。** candidates 只含 direct team members，不能搜尋全員 directory；group-only caller 仍可留言；client 傳非 direct member ID 必須拒絕，不能僅靠候選 UI。team mention 存 NULL shareLinkId、無 follow/share grant；creator/self 去重沿用，personal mention 仍要求 live link。帶有 token 的匿名 query 不能讀 team document。
- [ ] **Step 3 — 驗證失敗。** `npm run test:integration -- tests/integration/publication-review.test.ts` → FAIL。
- [ ] **Step 4 — 實作 scope。** 抽 common document/source/workspace lookup，`linkScope` 明確保持 PERSONAL；member scope 需 flag on、active team、`document.read`、PUBLICATION metadata。既有 personal owner 路徑保留。所有 private owner uses 改讀明確 `ownerUserId`，moderation 獨立判權；team 一般 query 用 member projection，只有 creator/admin 可用 moderator projection。writes-enabled、quota/rate limit、revision anchor/outdated quote 與 idempotency hash 的既有語意保留。
- [ ] **Step 5 — 調整持久化。** `ShareCommentEvent.originShareLinkId: string | null`、`recipientUserId: string | null`；`ReviewMention.shareLinkId: string | null`，NULL 的 team context 由 comment→thread→document→source 判定。team comment 即使無 originShareLinkId 也可通知 creator；team mention 不呼叫 `followForMention`。
- [ ] **Step 6 — 驗證及提交。** 上述 integration 及 `document-review-service.test.ts`、`review-mentions.test.ts`、`review-reply-follow.test.ts`、`npm run test:unit -- tests/unit/share-link-single-exception.test.ts` PASS；commit `feat(review): discuss published team documents as members`。

### Task 10: Inbox 全路徑判權及團隊導覽

**Files:** Modify knowledge `application/document-review-service.ts`, `domain/share-comment-event.ts`, `ports/share-comment-event-repository.ts`; MariaDB `repositories/share-comment-events.ts`; `src/components/knowledge/{notification-href,inbox-discussion}.tsx`（`notification-href` 實際為 `.ts`）；Test `tests/integration/publication-inbox.test.ts`, `tests/unit/publication-notification.test.ts`.

**Consumes:** Task 9 team scope。**Produces:** notification view 新增 `access?: { kind: "SHARE_LINK" } | { kind: "TEAM"; available: boolean }`，舊 personal/follow entries 不必填。team mention 保持 kind MENTION，但 href 依 access 分支，不再只依 kind 推定 share token。

- [ ] **Step 1 — 寫失敗測試。** creator Inbox 收 comment；被提及者收 mention；移除 direct membership 或撤銷本人的 group 後，recent activity entry 的 title/excerpt/author/URL/token 均空，`notificationHref(entry) === null`。重新取得 access 後同一歷史 entry 正常顯示。team entry 使用 `/w/<team>/knowledge/<source>/<doc>?thread=<id>`，沒有 `/s/` token。
- [ ] **Step 2 — 寫所有 side path 測試。** unread list/count 不洩漏 inaccessible team 事件，無權事件不計入 badge；markEventRead、markThreadRead、markAllActivityRead 只改 caller 仍可讀的 team rows，單筆無權操作拒絕、bulk 跳過無權 rows；hide 重新判 member + creator/admin。team mentions 失權不套用 personal dead-link 自動標已讀流程，保留 row 與 read state 供復權；My Shares 的 per-share counts 不混入 team entries。
- [ ] **Step 3 — 驗證失敗。** `npm run test:unit -- tests/unit/publication-notification.test.ts`；`npm run test:integration -- tests/integration/publication-inbox.test.ts` → FAIL。
- [ ] **Step 4 — 實作。** recipient SQL 涵蓋 personal owner 或 explicit team recipient，並調整所有 list/count/mark 方法，不只改列表。擴充 port 的 count row 帶 workspaceId 供 service 依 caller 判權，提供批次 mark 指定已判權 event IDs；每 request 每 workspace 快取 capabilities，不跨 request 快取 groups。讀 title/body/user 之前先 judge team access；unavailable activity 回不命名 shape。提及候選及 Inbox 的 team access 都要求 flag on。
- [ ] **Step 5 — 驗證及提交。** 上述指令及既有 review-reply-follow / review-mentions integration PASS；commit `feat(review): recheck team inbox access on every request`。

### Task 11: Publication API 與安全的讀模型

**Files:** Create `src/app/api/publications/route.ts`, `preview/route.ts`, `[publicationId]/{join,leave,resume,unpublish,restore,rename}/route.ts`, `[publicationId]/status/route.ts`, `src/app/api/workspaces/[workspaceId]/publications/route.ts`; Modify `src/server/composition.ts`, `src/modules/sources/application/publication-service.ts`; Create `src/server/publication-http.ts`; Test `tests/unit/publication-routes.test.ts`, `tests/integration/publication-api.test.ts`.

**Consumes:** Task 6/8 commands。**Produces:** 公開 `applicationServices().publications`，不輸出 projection binder；`list(caller, teamId, includeArchived?): Promise<PublicationListItem[]>`、`status(caller, publicationId): Promise<{ pending: boolean; report: ReconcileReport | null }>`。list item 含 `publication`, `creatorName`, `updatedAt`, `canJoin`, `canManage`, `ownContribution`；不回傳他人 personal origin IDs。status 只回本人 contribution 與仍有權存取團隊的資訊。

- [ ] **Step 1 — 寫失敗測試。** 每個 route 的 happy path、malformed UUID/body 400、缺 caller 的既有 auth 行為、off 404、non-member 404、VIEWER publish 403；duplicate name 400/`PUBLICATION_NAME_TAKEN` 並提示「已有同名發佈，請取一個能說明內容的名字」；restore claim conflict 回明確 domain code。list status 都重新判 caller read；他人的 contribution report 無法讀。preview 無寫入。
- [ ] **Step 2 — 驗證失敗。** `npm run test:unit -- tests/unit/publication-routes.test.ts`；`npm run test:integration -- tests/integration/publication-api.test.ts` → FAIL。
- [ ] **Step 3 — 實作薄 routes。** 沿用現有 trusted caller/error envelope；POST body 使用 Task 6 input，join body `{folderNodeId, acknowledgeLowOverlap?}`、rename `{name}`，所有 flag/access 也在 application service 檢查。REST restore 不能用 admin caller 當作所有 contributors 的 caller；仍走 Task 8 NO_CALLER。
- [ ] **Step 4 — 驗證及提交。** 上述指令 PASS；commit `feat(api): expose publication commands and status`。

### Task 12: UI、link/path adapter、團隊角色及所有內容入口

**Files:** Create `src/components/publications/{publish-dialog,join-dialog,publication-menu,publication-entry-meta,maintained-by-notice}.tsx`; Modify `src/components/knowledge/{knowledge-tree,source-sidebar,owner-review-panel,workspace-content-actions,sidebar-get-started}.tsx`, `src/components/imports/import-preview.tsx`, workspaces `{members-settings,groups-settings,grant-row-actions,create-team-dialog}.tsx`；reader page `src/app/w/[workspaceId]/knowledge/[sourceId]/[documentId]/page.tsx`；MariaDB `repositories/{document-links,linked-entries,knowledge-search}.ts`; Test `tests/unit/publication-ui.test.tsx`, `tests/integration/publication-links.test.ts`.

**Consumes:** Task 11 APIs、Task 9 review view、Task 10 notification access。**Produces:** My Space context menu 的「發佈到團隊」、folder publication 的「加入」、本人的「離開／繼續更新」、creator/admin 的「取消發佈／封存、還原、重新命名」。每個 publication 是 source 一個 top-level entry，不放在其他 source 的 folder 下。

- [ ] **Step 1 — 寫失敗 UI 測試。** dialog 預填 origin 名稱，target teams 僅列可發佈者，顯示 name/claim 錯誤、strong-overlap suggestion 及 low-overlap acknowledgment；錯誤時 dialog 保持、避免重複 submit。tree 顯示 publication creator、更新時間及文件「由 Mike 維護」；left/rights-frozen 顯示「不再更新」，pending 與 frozen 不混用；revision attribution 用「更新者」。sync preview/result 顯示「由 Mike 維護，你的版本不會更新團隊」及 blocked-path 原因，status 完成後刷新。
- [ ] **Step 2 — 寫入口/角色測試。** team sidebar、empty state、全域 add menu、sources/import 頁導覽都不提供新增文件/資料夾/匯入；personal 入口照常。direct/group role selectors 都只提供 管理員 ADMIN、成員 EDITOR；現有 OWNER/VIEWER 僅作既有角色顯示，不靜默改角色，不能選取。UI 隱藏不改四角色 capability bundles。review panel 對 publication team 成員呈現，一般 member 看不到 moderation controls 或 follow switch，creator/admin 才可 hide。
- [ ] **Step 3 — 寫 link/read adapter 測試。** synced team copy 的 relative `.md` link 只在同一 publication source 解析；Hub/single-document 的 path 是 NULL、相對連結 unresolved；wikilink 同一 source 優先、可指其他 team source、絕不跨 workspace。未發佈 target 渲染純文字、不自動發佈；普通 team search 和 path filter 能找到 publication copies，source archived 即消失。
- [ ] **Step 4 — 驗證失敗。** `npm run test:unit -- tests/unit/publication-ui.test.tsx`；`npm run test:integration -- tests/integration/publication-links.test.ts` → FAIL。
- [ ] **Step 5 — 實作 adapters 與 UI。** link catalog 及 search path predicate 依 SourceType 選 publication_documents.source_path 或 source_entries.source_path，沿用現有 resolver，不另建 team resolver。linked-entry 的 read path 能取得 publication path，對 publication update 拒絕；不可 COALESCE 成 `''` 或 fake path。沿用既有 Dialog/Button/SelectMenu、loading/error/focus return 與 light/dark tokens；閱讀器繼續使用安全 Markdown renderer。
- [ ] **Step 6 — 驗證及提交。** 上述指令及 `npm run lint`、`npm run typecheck` PASS；commit `feat(ui): publish from My Space and read team publications`。

### Task 13: 端到端驗收、文件與發佈證據

**Files:** Create `tests/e2e/zz-team-publishing.spec.ts`, `docs/superpowers/verification/2026-10-31-team-space-publishing.md`; Modify `tests/e2e/fixtures/phase3-server.ts` / `phase3-identities.ts`（僅補測試所需資料）、`CLAUDE.md`, `README.md`, `README.zh-TW.md`, `docs/operations/team-workspaces-availability{,.zh-TW}.md`.

**Consumes:** Tasks 1–12。**Produces:** 有開旗標/關旗標證據的完整可交付流程與維運手冊。既有 spec 的「Not yet planned」狀態在最後文件整理時更新為計劃連結，不改已核准的行為。

- [ ] **Step 1 — 寫 E2E。** 用既有 Phase 3 trusted identities 建 Mike/Ann 兩個 browser/server persona（不從 client 任意傳 user ID）：Mike 同步資料夾→發佈「HCM KM 設計」→Ann 閱讀與留言→Mike Inbox 開團隊文件→Mike 在 My Space 更新→poll 到副本更新；Ann join 同路徑新版，preview/result 告知由 Mike 維護且不覆寫；移除 Mike 後 Inbox 不命名且無 link。另測 own archived-path reattach 保留討論、取消發佈後存原件不會復活 publication。新 team 測試標 `@smoke-team`，不影響 personal-only suite。
- [ ] **Step 2 — 跑聚焦驗收。** `npm run test:e2e -- tests/e2e/zz-team-publishing.spec.ts` → 所有新案例 PASS；失敗要記錄原因並修復，不把失敗預設為 flake。
- [ ] **Step 3 — 跑完整必要 gates。** `make verify`、`npm run test:integration`、`npm run test:e2e:smoke`、`npm run test:e2e:smoke:personal` 均 PASS；若環境無法執行某項，verification 文件明列未驗證，不填 PASS。確認兩個 writer guards、匿名 share-link guard、既有 personal review/follow/mention regressions 都包含在執行結果中。
- [ ] **Step 4 — 寫可操作文件。** 說明唯一建立者、join/non-creator notices、LEFT vs rights freeze vs pending、來源唯讀、admin 全 publication archive、restore conflict、開關與 catch-up 指令。README canonical table 加 spec+plan+verification；CLAUDE invariants 加 publication 唯一寫入機制及需要 caller 的 team discussion。verification 記錄日期、HEAD、實際命令、結果及未解決限制。
- [ ] **Step 5 — 提交並回報。** commit `test: verify team publishing workflow and rollout`；回報變更摘要、測試證據、flag 仍 default-off 與需執行的修復指令。部署或正式開啟旗標另依使用者授權處理。

## Transaction and Concurrency Rules

這些規則適用所有任務，避免各任務自行決定互不相容的鎖順序：

- 不在原件交易中做 team reconciliation。已提交的原件才進入排程；team failure 不 rollback 原件。
- 對既有 rows 的操作先路由得到所有相關 source IDs，以穩定 ID 排序取得 Source locks，再以穩定 ID 排序取得 Workspace shared locks，再鎖 contribution/document/binding。Workspace lifecycle/membership 管理維持既有 exclusive lock。不得在持有 Workspace 後回頭取得另一個既有 Source lock。
- preview 不持有 write locks；正式 publish/join/restore 必須鎖內重查。新 source 建立依賴 DB active-name unique key，不用先鎖整個 Workspace 再遍歷既有 sources。
- publication Source lock 序列化同一 publication 的 path/binding 變更；跨 publication 的 original claim race 由 DB unique key 決定，duplicate-key 要轉可讀 domain outcome。
- `APPLIED` report、delivery 完成及 event consumed 判斷都在可 rollback 的 transaction 內；一個目標 pending/failed 時，其他目標可先完成，root event 保持未完成。
- 同一批 contributor 的 final state 一起計算；path swaps 的暫時 NULL 僅存在未提交交易內，外部永遠看不到中間狀態。

## Self-Review and Handoff

已逐節對照 spec：publish/join/creator-only 更新→Tasks 1–7；path reservation/reattach/final-state→Tasks 1、2、5；roles/read-only→Tasks 3、9、12；team review/mention/Inbox→Tasks 9–10；LEFT/freeze/flag/catch-up→Tasks 5、7–8；archive/name/claims→Tasks 2、8；links/tree/search→Tasks 5、12；入口與 rollout→Tasks 11–13。Review Focus 五項都有指定測試任務。所有後續任務共用 Task 1 型別，事件與投影沒有引入 Knowledge→Sources import。

本計劃只建立規劃文件；測試指令是實作時的驗收步驟，尚未執行。請先 review。建議以 **Subagent-driven** 執行：資料庫唯一約束、creator-only 投影與 Inbox 權限各有獨立失敗面，適合每個任務完成後由新的 reviewer 檢查；也可選 **Native**，由目前 agent 依序實作後作整體 review。執行方法由使用者確認後才開始實作。

# Knowledge Hub — Phase 3 Workspace Product Closure Design

| 項目 | 內容 |
| --- | --- |
| 文件日期 | 2026-09-15 |
| 文件類型 | Design Spec amendment；不包含 Implementation Plan |
| 狀態 | Approved — implementation plan written |
| Parent spec | `docs/superpowers/specs/2026-09-14-phase-3-identity-workspace-governance-design.md` |
| 前置 | Phase 2.5 Frontend Product Baseline、Phase 3 Identity / Workspace Governance Tasks 1–11 |
| 目的 | 補齊 Phase 3 Task 12–14 的 API、UI、操作流程與 release acceptance，使 Workspace governance 不只存在於底層，而是能被 Human Web product 完整操作與理解 |

## 1. Decision summary

Phase 3 在進入 Phase 4 前，必須完成 Workspace governance 的 product closure。

這不是新 Phase、不是 Phase 3.5，也不新增 Task 15。實作範圍仍落在既有：

```text
Task 12 — server/admin API contracts
Task 13 — My Space / Workspace / Team governance UI
Task 14 — acceptance, security regression, rollout verification
```

Phase 3 完成標準從「RBAC / lifecycle / identity 已實作」提高為：

> Workspace scope、role、lifecycle、governance 與 import entry point 都能透過產品 UI 真實操作，且每個 UI 行為與 server-side authorization / lifecycle semantics 一致。

Visual polish、Dashboard 與 Search/Retrieval UI 不屬於這個 closure；它們可以在 Phase 4 或之後處理。

## 2. Goals

Phase 3 product closure MUST：

1. 讓 `/` deterministic 進入 My Space，而不是第一個 Team。
2. 讓 Workspace selector 清楚表達 Personal、Active Team、Archived Team。
3. 讓具有 platform capability 的 user 從 selector 建立 Team。
4. 讓空的 My Space / Team 能直接進既有 folder import flow。
5. 讓 ADMIN / OWNER 能從產品 UI 完成 Team governance。
6. 讓 direct membership 與 SSO Group access 的差異可被管理者正確理解。
7. 讓 archived Team 清楚呈現 read-only，而不是只靠 mutation 失敗推知狀態。
8. 讓 revoke、archive、restore 後的前端 navigation deterministic。
9. 讓 UI 不自行猜 role/lifecycle；server 回傳 UI-ready capability/action model。
10. 讓 Task 14 驗證完整 Human journey，而不只驗 route/API 存在。

## 3. Non-goals

這個 closure MUST NOT 引入：

- invitation / pending membership lifecycle。
- 以任意 `emp_id` 建 membership。
- company directory picker 作為 Phase 3 dependency。
- ownership transfer flow。
- self-service `Leave Team`。
- onboarding wizard 或 draft Team。
- per-user last-workspace / last-page persistence。
- 完整 other-user external-group membership lookup。
- advanced Audit filters、export、analytics dashboard。
- Search / semantic retrieval UI。
- visual redesign、animation、advanced personalization。
- 新的 Workspace / membership / group schema 欄位。

Company production SSO hookup 可在公司環境完成；Local provider + trusted test claims 必須先把相同 authorization semantics 驗證完。

## 4. Canonical product journey

Phase 3 必須支援：

```text
Login
→ My Space
→ empty state / Import knowledge
→ Create Team
→ Team knowledge
→ Team Settings
→ Add existing Hub user
→ Configure SSO Group mapping
→ Inspect direct / effective access truthfully
→ Revoke direct access
→ Archive Team
→ Read archived knowledge
→ Restore Team
```

這條 flow 是 Task 13 E2E 與 Task 14 Product Acceptance 的主幹。

## 5. My Space default entry

Phase 2.5 的「first accessible Workspace」root resolution 在 Phase 3 被覆寫：

```text
/
→ establish trusted caller
→ ensurePersonalWorkspace(caller.identity.id)
→ /w/:mySpaceId/knowledge
```

Rules：

- My Space 永遠是登入預設 scope。
- 不讀 last Workspace。
- 不因 user 已有 Team access 而跳 Team。
- My Space 沒有 Source 時顯示 empty state，不跳 Team。
- direct Team deep link 仍可直接進入；root default 與 deep-link authorization 是兩件事。
- My Space 不顯示 Members、SSO Groups、rename、archive、ownership controls。

## 6. Workspace selector

Workspace selector 是 authorization scope switcher，不是 authorization source of truth。

Canonical ordering：

```text
My Space
────────────
Teams
  Active Team A
  Active Team B

Archived
  Archived Team A
  Archived Team B
────────────
+ Create team
```

Ordering 必須 deterministic：

```text
My Space first
→ ACTIVE TEAM by name ASC, id ASC
→ ARCHIVED TEAM by name ASC, id ASC
```

Rules：

1. Archived 區可預設折疊；當前 scope 為 archived Team 時自動展開。
2. unauthorized Workspace 永遠不出現。
3. `+ Create team` 只有 caller 具 `workspace.create_team` platform capability 時顯示。
4. selector 不顯示 org_code、owner、member count，也不把 role 當 authorization truth。

### 6.1 Workspace switching

切換任何 Workspace 一律進目標 Workspace Knowledge root：

```text
/w/:targetWorkspaceId/knowledge
```

不保留上一個 Workspace 的 Source、Document、Settings tab 或 import state。

## 7. Team creation

Create Team 從 Workspace selector 底部開始。

Dialog 只要求：

```text
Team name
```

Product flow 不在 Team-create request 內提交 member 或 SSO Group mapping。Backend 既有 group governance 保持獨立操作；不引入 draft Team 或 partial onboarding state。

Success semantics：

```text
create TEAM Workspace
+ creator DIRECT OWNER
+ append audit
→ refresh selector
→ /w/:newTeamId/knowledge
```

## 8. Empty-state import entry

空 Workspace 直接導向既有 Phase 2 import flow，不建立 onboarding wizard。

```text
My Space empty + source.manage
→ "Import your first knowledge source"
→ /w/:workspaceId/sources/import

Active Team empty + source.manage
→ "Import knowledge"
→ /w/:workspaceId/sources/import

Active Team empty + no source.manage
→ "No knowledge sources yet"
→ no Import CTA

Archived Team empty
→ no Import CTA for any role
```

## 9. Navigation and Settings visibility

Phase 2.5 primary navigation 保持 Knowledge / Sources；Phase 3 在適用時增加 Team Settings。

```text
Knowledge
Sources
Settings   # TEAM + canOpenSettings only
```

Rules：

- Team Settings 只有 ADMIN / OWNER 可進。
- EDITOR / VIEWER 不顯示 Settings navigation。
- EDITOR / VIEWER direct URL 仍由 server authorization 拒絕；hidden navigation 不算 security boundary。
- My Space 不顯示 Team Settings。
- Sources management entry 對具 `source.manage` 的 caller 顯示；VIEWER 不顯示沒有可操作性的 Sources management navigation。
- Archived Team 對原本具 Source management capability 的 caller可保留 read-only Source inspection，但所有 mutation action 必須消失；這是 presentation behavior，不改 role capability bundle。

Recommended Team settings routes：

```text
/w/:workspaceId/settings
/w/:workspaceId/settings/members
/w/:workspaceId/settings/groups
/w/:workspaceId/settings/audit
```

## 10. UI-ready server action model

Frontend MUST NOT 以散落的 `role === "OWNER"` 判斷自行重建 policy。

Server/query layer 應回傳 caller capability + lifecycle 計算後的 UI-ready actions，例如：

```ts
export type WorkspaceActions = {
  canImport: boolean;
  canInspectSources: boolean;
  canOpenSettings: boolean;
  canRename: boolean;
  canArchive: boolean;
  canRestore: boolean;
  canManageBasicMembers: boolean;
  canManageAdminMembers: boolean;
  canManageOwners: boolean;
  canManageBasicGroups: boolean;
  canManageAdminGroups: boolean;
  canReadAudit: boolean;
};
```

Archived Team 的 ordinary mutation actions 必須直接為 `false`。`canInspectSources` 與 `canImport` 分開：以 `source.manage` 決定 Sources inspection entry，ARCHIVED 時 inspection 可保留，但 import 必須為 false。

Frontend 使用 action flags 做 presentation；API route 仍必須重新 authorization。Action flags 不是 authorization token。

## 11. Workspace read models

Selector 使用 caller-visible navigation model：

```ts
export type WorkspaceNavigationItem = {
  id: string;
  name: string;
  type: "PERSONAL" | "TEAM";
  lifecycleState: "ACTIVE" | "ARCHIVED";
};
```

`canCreateTeam` 是 caller/platform-level state，不重複附在每個 Workspace item 上。

Team detail view 至少包含：

```ts
export type TeamWorkspaceView = {
  id: string;
  name: string;
  lifecycleState: "ACTIVE" | "ARCHIVED";
  caller: {
    directRole: WorkspaceRole | null;
    effectiveCapabilities: readonly WorkspaceCapability[];
  };
  actions: WorkspaceActions;
  grantOptions: WorkspaceGrantOptions;
};

export type WorkspaceGrantOptions = {
  newMemberAssignableRoles: readonly WorkspaceRole[];
  newGroupAssignableRoles: readonly ("ADMIN" | "EDITOR" | "VIEWER")[];
};
```

## 12. Existing Hub user membership management

Phase 3 Add member 只允許選擇已存在的 Hub User。

User lookup contract 只提供 existing Hub users；不是 invitation 或 identity provisioning API。

Membership write payload 使用 canonical Hub `userId`：

```ts
{
  userId: string;
  role: WorkspaceRole;
}
```

MUST NOT 支援 arbitrary `emp_id` membership creation、browser-provided external subject linking、pending invite 或 implicit User creation。

未來 company directory integration 可替換 lookup source，但 membership identity 仍是 Hub `userId`。

## 13. Team member administration UI

Members 使用 table/list，分開呈現 direct grant 與 group-derived truth：

```text
Name
Direct role
Group access
Actions
```

Role mutation ceiling：

```text
ADMIN
→ manage EDITOR / VIEWER only

OWNER
→ manage OWNER / ADMIN / EDITOR / VIEWER
```

Assignable role choices 由 server contract 或 capability-policy-derived presentation model 產生，不在 component 中重新 hardcode policy。

### 13.1 Creation options and existing-row options

Team Settings model 必須包含 `grantOptions`，不依賴目前是否已有 member/group rows：

- ACTIVE effective ADMIN：新增 member/group 都只能選 EDITOR、VIEWER。
- ACTIVE direct OWNER：新增 member 可選 OWNER、ADMIN、EDITOR、VIEWER；新增 group 可選 ADMIN、EDITOR、VIEWER。
- ARCHIVED 或無對應管理能力：新增角色陣列為空；新增 controls 不顯示。

Add Member 的搜尋結果仍是 existing Hub user identity，選定 candidate 後使用 `newMemberAssignableRoles`；新增 Group 使用 `newGroupAssignableRoles`。既有 row 的 `assignableRoles` 只供修改該 row，必須另外考慮 persisted beforeRole、最後一位 direct OWNER 與 lifecycle；不得挪用既有 row 的選項來初始化新增表單。所有選項由 server 產生，寫入時仍重新驗證。

### 13.2 No self-service leave

Phase 3 不提供 `Leave Team`。

Direct membership 的 add/update/remove 由 ADMIN / OWNER governance 完成；ownership transfer 也不在 Phase 3。

## 14. Truthful effective-access presentation

Canonical authorization：

```text
effective capabilities
= direct capabilities
  UNION
  matched validated-group capabilities
```

Current caller 的 validated group claims 可用，因此可顯示完整 matched groups / effective capabilities。

對 other user，如果 Phase 3 沒有可信 external-group membership source，就不能把 unknown 當 empty。

```ts
export type UserAccessInspection = {
  userId: string;
  directRole: WorkspaceRole | null;
  groupAccess: "EVALUATED" | "UNKNOWN_NOT_EVALUATED";
  matchedGroups?: readonly {
    externalGroupId: string;
    role: WorkspaceRole;
  }[];
  effectiveCapabilities?: readonly WorkspaceCapability[];
};
```

UI wording：

```text
Direct role: EDITOR
Group access: Not evaluated
```

不得在資料未知時顯示推導出的 `Effective role: EDITOR`。

## 15. Revoke semantics

Remove direct membership 不等於保證完全撤權。

Confirmation MUST 明確說明：

```text
Removing direct access may not fully revoke access if this user
is still granted access through an SSO group.
```

### 15.1 Current caller loses all access

若 mutation 後 current caller 不再有 `workspace.discover`：

```text
Team disappears from selector
→ redirect /w/:mySpaceId/knowledge
→ one-time notice: "You no longer have access to this workspace."
```

My Space 是 deterministic fallback；不自動跳其他 Team。

### 15.2 Direct grant removed but group access remains

若 group grant 仍提供 access：

- caller 留在 Team。
- UI 依新的 effective capabilities 立即收斂。
- 例如 direct EDITOR 被移除、group VIEWER 仍存在，write/import controls 消失但 read 保留。

Frontend MUST NOT 以「membership row 被刪除」直接判斷 caller 應離開 Workspace。

### 15.3 Affected-client refresh and route convergence

管理者 mutation 後的 refresh 不會更新另一位使用者的 browser。所有 Workspace shell（包含 Knowledge、Sources、Settings、Import）必須有共用授權刷新機制：

- 初次載入、Workspace/route navigation、成功 mutation 後立即刷新。
- window focus / visibility 回到 visible 時立即刷新。
- visible page 每 30 秒刷新一次；hidden page 停止 timer，重新 visible 時刷新。
- 遇到 API 403、404 或 lifecycle 409 時刷新 Workspace 授權，再決定路由；Source/Document 自己的 404 不直接代表整個 Workspace 失權。

使用 caller 的 navigation model 取得 My Space 與目前可 discover 的 Workspace 清單，再取得目前 Workspace 的 read-safe state/capabilities/actions。此 state endpoint 對所有可 discover 的 caller 開放，不要求 Settings 管理能力，不回傳 member/group/audit 或 Knowledge content；未知／不可 discover 的 Workspace 維持 generic 404。Settings model 本身仍是 ADMIN/OWNER-only。

刷新後使用下列 state machine：

| Fresh authorization | Current surface | Result |
| --- | --- | --- |
| 無 workspace.discover | 任何先前已載入的 Workspace | 清除該 scope 的 content/preview cache，selector 移除，replace 至 My Space，顯示一次性 notice |
| 仍可讀，但失去 canOpenSettings | Settings | replace 至同 Team Knowledge root |
| 仍可讀，但失去 canImport 或 Team 已 archive | Sources/import/update/preview | 保留同 Team；停止後續 upload/finalize/apply，移除 mutation controls，顯示 read-only／權限改變說明；可保留仍被授權的 preview read |
| 仍有當前頁面能力 | 任意 | 原地刷新 capabilities/actions |

從未成功載入的任意 Workspace deep link 仍是 generic 404，不以 fallback 洩漏存在性。暫時網路錯誤／5xx 不當作撤權；顯示 retry state，未能確認權限期間暫停 mutation controls。使用 abort 或 request generation 防止舊 response 蓋掉新授權／切換後的 Workspace；unmount 清除 timer。

健康網路下，visible 的受影響頁面應在下一次 30 秒 polling 完成後收斂；這是 UI freshness budget，不是授權寬限期，API 每次仍即時驗證。E2E 必須以管理者與受影響者兩個獨立 browser contexts 驗證以上行為。

## 16. SSO Group administration

Phase 3 不依賴 company directory picker。

Canonical mutation payload 維持既有 schema 欄位：

```ts
{
  externalGroupId: string;
  role: "ADMIN" | "EDITOR" | "VIEWER";
}
```

Rules：

- `externalGroupId` 是唯一 authorization key。
- Phase 3 不新增 persisted display-label 欄位。
- 若 UI 需要友善 label，只能是 non-authoritative presentation；不得成為 grant identity，也不得要求 schema migration。
- ADMIN 可建立/更新 Group → EDITOR / VIEWER。
- OWNER 可建立/更新 Group → ADMIN / EDITOR / VIEWER。
- Group 永遠不能 grant OWNER。

未來 directory search picker 只替換輸入 UX，最終仍提交 canonical `externalGroupId`。

## 17. Audit UI

Audit 是 governance evidence surface，不是 analytics dashboard。

Phase 3 至少提供 newest-first ordering、pagination/Load more、actor、event summary、target、timestamp 與 relevant before/after role/state details。

ADMIN / OWNER 可讀 Team audit。

Phase 3 不做 advanced filters、export 或 charting。

## 18. Team lifecycle UI

### 18.1 Active Team archive

Archive 是 OWNER-only danger action：

```text
Settings
→ General
→ Danger zone
→ Archive workspace
```

Confirmation MUST 說明 Knowledge 保留且仍可讀、imports/content mutation 停止、workspace administration mutation 停止、OWNER 可以 restore。

Archive 成功後留在同一 Team，不跳 My Space。

### 18.2 Archived Team presentation

Archived Team 顯示 persistent banner：

```text
Archived workspace
This workspace is read-only. Existing knowledge remains available.
```

OWNER 另外看到 `Restore workspace`。

| Surface | ADMIN | OWNER |
| --- | --- | --- |
| Knowledge | read | read |
| Sources | read-only / no mutation | read-only / no mutation |
| General | status only | status + Restore |
| Members | read-only | read-only |
| SSO Groups | read-only | read-only |
| Audit | read | read |
| Rename | no | no |
| Member/group mutation | no | no |
| Restore | no | yes |

VIEWER / EDITOR 仍依 read capability 閱讀 Knowledge，但沒有 governance surface。

Archived 是 lifecycle state，不是另一種 role。

### 18.3 Restore

Restore 成功後 Workspace ID、Source/Document IDs、memberships、group mappings 全部不變；ordinary mutations 依 effective capabilities 恢復。

### 18.4 Existing Knowledge / Sources / Import retrofit

既有頁面必須接入相同 server action model，不能只隱藏 primary navigation：

- `/w/:workspaceId/knowledge` 的空狀態直接 render Knowledge empty state，移除既有無 Source 就 redirect Sources 的行為。
- Sources list 的 Import folder、Source detail 的 Update from folder，都必須依 Workspace actions 顯示。
- Source update 另須通過既有 `isFolderSyncable(source)`；Workspace 可 import 不代表所有 Source 都可更新。
- Import/create/update direct URLs 必須 server-side 驗證當前能力與 lifecycle，VIEWER／ARCHIVED 不 render 可提交的表單。
- `FolderImportForm` 與 snapshot preview/apply footer 接收 server-derived mutation allowance；Apply 仍同時依 snapshot state、expiry、blockers 等既有限制判斷。
- 權限或 lifecycle 改變時採 §15.3 的刷新／收斂機制，creator-private snapshot 與 discover/read 錯誤語意仍保持。

## 19. Team Settings information architecture

Team Settings 僅 ADMIN / OWNER 可進：

```text
General
Members
SSO Groups
Audit
```

### General

OWNER 可 rename Team、inspect lifecycle、archive Active Team、restore Archived Team。

ADMIN 只 inspect Team name / lifecycle；不顯示無權執行的 rename/archive/restore controls。

### Members

- list direct membership。
- separate direct role from effective/group state。
- add existing Hub user。
- mutate/remove direct role subject to actor ceiling。

### SSO Groups

- list mapping。
- manually enter canonical externalGroupId。
- role selection subject to actor ceiling。

### Audit

- read-only governance event history。

## 20. API error contract and UI presentation

Governance API 必須提供 stable semantic error code；frontend 不 parse human-readable backend message。

```ts
export type ApiError = {
  code: string;
  message: string;
  field?: string;
};
```

Create Team 缺少平台能力時，保留 `TEAM_CREATION_DENIED` 並回 403。Create／rename 的名稱先 trim，長度必須為 1–200；不合法時使用專用 `INVALID_WORKSPACE_NAME`，回 400 並附 `field: "name"`，供表單 inline 提示。不得將其他 lifecycle error 全部當作名稱錯誤，或以 message 文字推導錯誤種類。

若 Create dialog 開啟後平台能力失效，提交被拒時保留 dialog 並顯示權限提示，刷新 navigation/actions；`canCreateTeam` 為 false 時停用後續提交。HTTP 測試需驗證無建立能力、空白名稱、超長名稱的 status/code/field，invalid create 不產生 Workspace、owner membership 或 audit event；rename 共用名稱驗證，UI 測試涵蓋 dialog 開啟後撤銷建立能力。

Minimum semantic errors：

```text
WORKSPACE_ARCHIVED
LAST_DIRECT_OWNER
INSUFFICIENT_WORKSPACE_CAPABILITY
TEAM_CREATION_DENIED
INVALID_WORKSPACE_NAME
MEMBER_NOT_FOUND
MEMBER_ALREADY_EXISTS
GROUP_MAPPING_ALREADY_EXISTS
INVALID_ROLE_ASSIGNMENT
WORKSPACE_NOT_FOUND
```

Presentation policy：

```text
field/form validation → inline
row/invariant conflict → row or dialog inline
workspace/global lifecycle state → banner
successful mutation → toast
undiscoverable resource → generic 404
```

404 behavior MUST preserve existing discover-vs-read non-disclosure semantics。

## 21. Role × lifecycle acceptance matrix

### 21.1 ACTIVE Team

| Capability / UI | VIEWER | EDITOR | ADMIN | OWNER |
| --- | ---: | ---: | ---: | ---: |
| Read Knowledge | yes | yes | yes | yes |
| Import / update Source | no | yes | yes | yes |
| Team Settings | no | no | yes | yes |
| Manage VIEWER / EDITOR | no | no | yes | yes |
| Manage ADMIN | no | no | no | yes |
| Manage OWNER | no | no | no | yes |
| Read Audit | no | no | yes | yes |
| Group → VIEWER / EDITOR | no | no | yes | yes |
| Group → ADMIN | no | no | no | yes |
| Rename | no | no | no | yes |
| Archive | no | no | no | yes |

### 21.2 ARCHIVED Team

| Capability / UI | VIEWER | EDITOR | ADMIN | OWNER |
| --- | ---: | ---: | ---: | ---: |
| Read Knowledge | yes | yes | yes | yes |
| Import / update | no | no | no | no |
| Content write | no | no | no | no |
| Member/group mutation | no | no | no | no |
| Rename | no | no | no | no |
| Read Audit | no | no | yes | yes |
| Restore | no | no | no | yes |

## 22. Direct + Group acceptance matrix

至少驗證：

| Direct role | Matched group role | Effective result |
| --- | --- | --- |
| none | none | no access |
| VIEWER | none | VIEWER capabilities |
| EDITOR | none | EDITOR capabilities |
| none | VIEWER | VIEWER capabilities |
| VIEWER | EDITOR | EDITOR capability union |
| EDITOR | VIEWER | EDITOR capability union |
| ADMIN | EDITOR | ADMIN capability union |
| VIEWER | ADMIN | ADMIN capability union |
| OWNER | ADMIN | OWNER capability union |

Group cannot grant OWNER。

## 23. UI + API dual enforcement

Hidden UI control 不是 authorization。

每個重要 operation 都需要兩層驗證：

```text
UI
→ no capability => action absent

API
→ direct call still reauthorizes and rejects
```

Examples：

```text
ADMIN archive
UI: action absent
API: rejected

EDITOR settings
UI: nav absent
Direct route/API: rejected

Archived OWNER add member
UI: action absent
API: WORKSPACE_ARCHIVED
```

## 24. Task 13 end-to-end product journey

Playwright 至少串起：

1. Login → `/` → My Space；empty My Space 不跳 Team。
2. My Space empty state → existing folder import flow。
3. Workspace selector → Create Team；creator 是 OWNER。
4. Empty Team → import flow。
5. Add existing Hub user as VIEWER。
6. Change member VIEWER → EDITOR。
7. Add SSO Group → EDITOR。
8. 驗證 OWNER / ADMIN / EDITOR / VIEWER navigation/action 差異。
9. Remove direct access；完全失權時 fallback My Space；group access 殘留時仍留 Team。
10. Archive Team；Knowledge 仍可讀，ordinary mutations 消失。
11. OWNER Restore；mutation capability 恢復。
12. Audit 顯示上述 governance events。
13. My Space 全程沒有 Team governance UI。

### 24.1 Trusted multi-user HTTP test harness

Local provider 原本不提供 company groups 或 `workspace.create_team`；不得假設現有固定 Local E2E user 可執行完整 journey。

在 Task 12 建立 test-only server identity fixture，再由 Task 13 Playwright 使用：

1. 所有 persona servers 共用同一個 disposable E2E MariaDB database；每個 Next process 在 startup 固定注入一份 server-owned identity/claims fixture，使用獨立 port。Browser context 綁定該 persona server，不能用 header/query/body 任意指定身份或角色。
2. Fixture 至少包含有／無 `workspace.create_team` 的 caller、direct OWNER/ADMIN/EDITOR/VIEWER、group-only ADMIN/EDITOR 與 direct EDITOR＋group VIEWER；Hub users、identity links、My Space 及 grants 以受控 seed/bootstrap 建立。
3. 測試用 server bootstrap/entry point 必須與正常 production entry point 分離。正常啟動不載入 fixture provider，也不提供切換 persona 的 HTTP route；僅有環境變數不足以把正常 production 切為 test identity。
4. Test bootstrap 可以把固定 claims reader 注入既有 `buildApplicationServices`／reader registration；每個 browser request 仍經真實 trusted bootstrap、readiness、API/application authorization 與 DB transaction，不 mock API success 或硬造 frontend action flags。
5. OWNER context 用真實 governance API/UI 改變 grants；受影響 persona 保留相同 server-validated group claims，再以其 browser context 驗證刷新與導向。不是只改同一個 page 的角色。
6. Retain 原本 production-build Local smoke/E2E；新增 identity fixture tests 不能取代正常 entry point 的 build、fail-closed 或 no-Local-fallback regression。

Fixture servers 在測試結束後關閉並刪除 disposable database；先以 HTTP smoke test 證明有權者可 Create Team、無權者遭拒及 browser input 無法覆寫 persona，再執行完整 journey。Company production hookup 仍獨立 pending。

## 25. Task 14 release gate

Phase 3 Product Acceptance 必須全部 PASS：

```text
Task 12 governance/server contracts
Task 13 Workspace + Settings UI
My Space default entry
Workspace selector ordering/grouping
role × lifecycle UI behavior
direct + group capability union
truthful other-user group state
revoke fallback semantics
archive / read-only / restore semantics
UI + API dual enforcement
semantic error presentation
audit correctness
existing migration / identity security regressions
existing lock-order / concurrency regressions
lint / typecheck / unit / integration / e2e / build
```

Existing Phase 3 backend hard gates remain unchanged，特別是 production no-Local-fallback、Hub-owned UUIDv7、durable `(provider,subject)` identity、008/009 staged safety、Personal uniqueness、direct OWNER invariant、atomic audit、canonical lock order、archive serialization、no Source/Document ACL。

## 26. Product Acceptance vs Production SSO Cutover

Verification report 必須分開：

```text
Phase 3 Product Acceptance
PASS | FAIL

Production Company SSO Cutover
PASS | PENDING COMPANY ENVIRONMENT | FAIL
```

Local provider + trusted test claims 可使 Product Acceptance PASS，只要 identity/group/platform-capability semantics 與 production contract 相同。

Company SSO production hookup 若尚未能在公司環境執行，可標 `PENDING COMPANY ENVIRONMENT`，不阻塞 Phase 4 product development；但不能宣稱 production cutover verified。

Populated-production migration/write-quiescence contract仍依 parent Phase 3 spec，不因本 amendment 改變。

## 27. Phase 3 → Phase 4 hard gate

Phase 3 完成的 product definition：

```text
A trusted caller can:

enter My Space
→ import knowledge
→ create Team
→ manage access
→ observe truthful direct/effective-access state
→ revoke access
→ archive
→ continue reading archived knowledge
→ restore

while every visible product action is backed by the same
server-side authorization and lifecycle rules.
```

只有 Product Acceptance PASS 才進 Phase 4 Search / Retrieval / Knowledge Discovery implementation。

Production Company SSO Cutover 可獨立標記 pending，但不得把 pending 當 verified。

## 28. Implementation planning handoff

Approved. Authoritative implementation plan:

`docs/superpowers/plans/2026-09-15-phase-3-workspace-product-closure.md`

該 plan 取代既有 Phase 3 plan 的 Task 12–14；不新增 Phase 3.5 或 Task 15。Tasks 1–11 已定的 identity、migration、repository、lock-order 與 cutover sequencing保持不變。

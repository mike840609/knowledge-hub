# Knowledge Hub — Phase 3 Workspace Product Closure Design

| 項目 | 內容 |
| --- | --- |
| 文件日期 | 2026-09-15 |
| 文件類型 | Design Spec amendment；不包含 Implementation Plan |
| 狀態 | Review requested |
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

Company production SSO hookup 可在公司環境完成；Local provider + trusted test claims 必須先把相同 authorization semantics 驗證完。

## 4. Canonical product journey

Phase 3 必須支援下列完整流程：

```text
Login
  ↓
My Space
  ↓
empty state / Import knowledge
  ↓
Create Team
  ↓
Team knowledge
  ↓
Team Settings
  ↓
Add existing Hub user
  ↓
Configure SSO Group mapping
  ↓
Inspect direct / effective access truthfully
  ↓
Revoke direct access
  ↓
Archive Team
  ↓
Read archived knowledge
  ↓
Restore Team
```

這條 flow 是 Task 13 E2E 與 Task 14 product acceptance 的主幹。

## 5. My Space default entry

Phase 2.5 的「first accessible Workspace」root resolution 在 Phase 3 被覆寫。

Canonical root behavior：

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

My Space 沒有 Team governance UI：不顯示 Members、SSO Groups、rename、archive、ownership controls。

## 6. Workspace selector

Phase 3 Workspace selector 是 authorization scope switcher，不是 authorization source of truth。

Ordering 固定由 server/query layer決定：

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

Rules：

1. My Space 永遠第一。
2. Active Teams 按 name ascending。
3. Archived Teams 獨立分區，按 name ascending。
4. Archived 區可預設折疊；當前 scope 是 archived Team 時自動展開。
5. unauthorized Workspace 永遠不出現。
6. `+ Create team` 只有 caller 具 `workspace.create_team` platform capability 時顯示。
7. selector 不顯示 org_code、owner、member count 或把 role 當 authorization truth。

### 6.1 Workspace switching

切換任何 Workspace 一律進目標 Workspace 的 Knowledge root：

```text
/w/:targetWorkspaceId/knowledge
```

不嘗試保留上一個 Workspace 的：

- Source。
- Document。
- Settings tab。
- import state。

Selector 的責任是切 scope，不是跨 scope 保存 context。

## 7. Team creation

Create Team 從 Workspace selector 底部開始。

Dialog 只要求：

```text
Team name
```

不在建立 wizard 中處理 member 或 SSO Group。

Success semantics：

```text
create TEAM Workspace
+ creator DIRECT OWNER
+ append audit
→ refresh selector
→ /w/:newTeamId/knowledge
```

不引入 draft Team 或 partial onboarding state。

## 8. Empty-state import entry

空 Workspace 應直接導向既有 Phase 2 import flow；不建立 onboarding wizard。

Rules：

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

Empty-state CTA availability 必須依 server-authorized capability + lifecycle 決定。

## 9. Product navigation and settings visibility

Phase 2.5 的 primary navigation 保持 Knowledge / Sources；Phase 3 只在適用時增加 Team Settings。

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
- `Sources` mutation controls 依 `source.manage` 決定；VIEWER 不看到沒有可操作性的 import/update CTA。

Recommended Team settings routes：

```text
/w/:workspaceId/settings
/w/:workspaceId/settings/members
/w/:workspaceId/settings/groups
/w/:workspaceId/settings/audit
```

## 10. UI-ready server action model

Frontend MUST NOT 以 `role === "OWNER"` 等散落判斷自行重建 policy。

Server/query layer 應回傳 caller capability 計算後的 UI-ready actions，例如：

```ts
export type WorkspaceActions = {
  canImport: boolean;
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

Lifecycle evaluation 也由 server 合併進 action model。Archived Team 的 ordinary mutation actions 必須直接為 `false`。

Frontend 可以使用 action flags 決定 presentation，但 API route 仍必須重新執行 authorization；action flags 不是 authorization token。

## 11. Workspace navigation/read models

Selector 使用 caller-visible navigation model：

```ts
export type WorkspaceNavigationItem = {
  id: string;
  name: string;
  type: "PERSONAL" | "TEAM";
  lifecycleState: "ACTIVE" | "ARCHIVED";
};
```

`canCreateTeam` 是 caller/platform-level state，不應重複附在每個 Workspace item 上。

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
};
```

## 12. Existing Hub user membership management

Phase 3 Add member 只允許選擇已存在的 Hub User。

User lookup contract 只提供可供管理 UI 搜尋的 existing Hub users；它不是 invitation 或 identity provisioning API。

Membership write payload 使用 canonical Hub `userId`：

```ts
{
  userId: string;
  role: WorkspaceRole;
}
```

MUST NOT 支援：

- arbitrary `emp_id` membership creation。
- browser-provided external subject linking。
- pending invite。
- implicit User creation。

未來 company directory integration 可替換 lookup source，但 membership identity 仍是 Hub `userId`。

## 13. Team member administration UI

Members 使用 table / list surface；每個 row 分開呈現 direct grant 與 group-derived truth。

Recommended row fields：

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

Assignable role choices 應由 server contract 提供或由 capability policy-derived presentation model產生，不在 component 中重新 hardcode policy。

### 13.1 No self-service leave

Phase 3 不提供 `Leave Team`。

Direct membership 的 add/update/remove 由 ADMIN / OWNER governance 完成。這避免產生「direct membership 已移除，但 SSO group 仍授權」時 `Leave` 語意不成立的 UX。

Ownership transfer 也不在 Phase 3。

## 14. Truthful effective-access presentation

Canonical authorization 仍是：

```text
effective capabilities
= direct capabilities
  UNION
  matched validated-group capabilities
```

Current caller 的 validated group claims 可用，因此可顯示完整 matched groups / effective capabilities。

對 other user，如果 Phase 3 沒有可信的 external group membership source，就不能把 unknown 當 empty。

Recommended view：

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

Confirmation MUST 明確表達：

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

## 16. SSO Group administration

Phase 3 不依賴 company directory picker。

Add mapping UI 先接受：

```ts
{
  externalGroupId: string;
  displayLabel?: string;
  role: "ADMIN" | "EDITOR" | "VIEWER";
}
```

Rules：

- `externalGroupId` 是 authorization key。
- `displayLabel` 只是 presentation metadata，不得參與 authorization。
- ADMIN 可建立/更新 Group → EDITOR / VIEWER。
- OWNER 可建立/更新 Group → ADMIN / EDITOR / VIEWER。
- Group 永遠不能 grant OWNER。

未來 directory search picker 只替換輸入 UX，最終仍提交同一個 canonical `externalGroupId`。

## 17. Audit UI

Audit 是 governance evidence surface，不是 analytics dashboard。

Phase 3 至少提供：

- newest-first ordering。
- pagination / Load more。
- actor。
- event type / human-readable summary。
- target。
- timestamp。
- relevant before / after role/state details。

ADMIN / OWNER 可讀 Team audit。

Phase 3 不做 advanced filters、export 或 charting。

## 18. Team lifecycle UI

### 18.1 Active Team archive

Archive 是 OWNER-only danger action，位置建議：

```text
Settings
→ General
→ Danger zone
→ Archive workspace
```

Confirmation MUST 說明：

- Knowledge 保留且仍可讀。
- imports / content mutation 停止。
- workspace administration mutation 停止。
- OWNER 可以 restore。

Archive 成功後留在同一 Team，不跳 My Space。

### 18.2 Archived Team presentation

Archived Team 顯示 persistent banner：

```text
Archived workspace
This workspace is read-only. Existing knowledge remains available.
```

OWNER 另外看到 `Restore workspace`。

Archived Team behavior：

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

VIEWER / EDITOR 仍可依原本 read capability 閱讀 Knowledge，但沒有 governance surface。

Archived 是 lifecycle state，不是另一種 role。

### 18.3 Restore

Restore 成功後：

- Workspace ID 不變。
- Source/Document IDs 不變。
- memberships 不變。
- group mappings 不變。
- ordinary mutations 依 effective capabilities 恢復。

## 19. Team Settings information architecture

Team Settings 僅 ADMIN / OWNER 可進：

```text
General
Members
SSO Groups
Audit
```

### General

OWNER：

- rename Team。
- inspect lifecycle state。
- archive Active Team。
- restore Archived Team。

ADMIN：

- inspect Team name / lifecycle state。
- 不顯示無權執行的 rename/archive/restore controls。

避免用 disabled dangerous controls 教使用者 policy；沒有 capability 的 action 直接不出現。

### Members

- list direct membership。
- separate direct role from effective/group state。
- add existing Hub user。
- mutate/remove direct role subject to actor ceiling。

### SSO Groups

- list mapping。
- manually enter canonical externalGroupId。
- optional display label。
- role selection subject to actor ceiling。

### Audit

- read-only governance event history。

## 20. API error contract and UI presentation

Governance API 必須提供 stable semantic error code；frontend 不 parse human-readable backend message。

Recommended contract：

```ts
export type ApiError = {
  code: string;
  message: string;
  field?: string;
};
```

Minimum semantic errors include：

```text
WORKSPACE_ARCHIVED
LAST_DIRECT_OWNER
INSUFFICIENT_WORKSPACE_CAPABILITY
MEMBER_NOT_FOUND
MEMBER_ALREADY_EXISTS
GROUP_MAPPING_ALREADY_EXISTS
INVALID_ROLE_ASSIGNMENT
WORKSPACE_NOT_FOUND
```

Presentation policy：

```text
field / form validation
→ inline

row / invariant conflict
→ row or dialog inline

workspace/global lifecycle state
→ banner

successful mutation
→ toast

undiscoverable resource
→ generic 404
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

Existing Phase 3 backend hard gates remain unchanged，特別是：

- production cannot silently use Local identity。
- Hub User ID remains Hub-owned UUIDv7。
- `(provider, subject)` is durable account identity truth。
- migration 008 / 009 staged safety。
- Personal uniqueness。
- direct OWNER invariant。
- atomic audit。
- canonical Source/Knowledge/import lock order。
- archive prevents later ordinary mutation commit。
- no Source/Document ACL introduced。

## 26. Product acceptance vs production SSO cutover

Verification report 必須分開：

```text
Phase 3 Product Acceptance
PASS | FAIL

Production Company SSO Cutover
PASS | PENDING COMPANY ENVIRONMENT | FAIL
```

Local provider + trusted test claims 可使 Product Acceptance PASS，只要 identity / group / platform-capability semantics 與 production contract 相同。

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

本文件 approval 後，下一步由 Superpowers `writing-plans` 更新既有 Phase 3 implementation plan 的 Task 12–14；不新增 Phase 3.5 或 Task 15。

Implementation plan 必須保留 Tasks 1–11 已定的 identity、migration、repository、lock-order 與 cutover sequencing，並只補強：

```text
Task 12
→ UI-ready server model
→ existing-user lookup
→ Team governance API
→ truthful access inspection
→ semantic API errors

Task 13
→ My Space root
→ grouped Workspace selector
→ Create Team dialog
→ capability-driven empty states/navigation
→ Team Settings General/Members/Groups/Audit
→ revoke/archive/restore UX
→ complete Playwright journey

Task 14
→ role/lifecycle/access matrices
→ UI/API dual enforcement
→ product acceptance report
→ explicit Product Acceptance vs Company SSO Cutover status
→ all existing security/concurrency/cutover evidence
```

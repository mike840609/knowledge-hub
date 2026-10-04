# Phase 3 Workspace Governance — 正式環境切換手冊

[English](phase3-workspace-governance-cutover.md) | **繁體中文**

本手冊依據 `docs/superpowers/specs/2026-09-14-phase-3-identity-workspace-governance-design.md` §15（legacy bootstrap、分階段遷移、readiness）與 §19（正式環境切換策略），說明所有 Phase 3 實作完成後的正式切換程序。§19 的所有前置工作完成並通過測試前，不得開始：支援 Phase 3 的 Workspace／membership／Personal／Team writers、Source／Knowledge／import canonical locking 改造、Personal backfill tooling（Task 7）、Company SSO provider、持久 identity-link resolver 與 capability authorization，以及 Team governance API／UI 與僅限 system 的 recovery。

## 切換順序（spec §19，步驟 1–11）

1. 在執行 008 **之前**停止 canonical writes，進入 maintenance mode。
2. 套用 migration 008，使 nullable UNIQUE 的 `personal_owner_user_id` 生效。
3. 明確將既有 Workspaces backfill 為 TEAM。
4. 執行明確的 Team role／owner bootstrap。
5. 執行可信任 legacy identity-link bootstrap；runtime 絕不使用 `emp_id` 認領帳號。
6. 為既有使用者建立／回填 My Space 與 OWNER／SYSTEM_PERSONAL（Task 7）；並行重複請求由 008 unique constraint 收斂。
7. 維持停寫，套用 migration 009 的最終 constraints／FKs（Task 11）。
8. 通過 production readiness：009 已套用、company provider 已設定、identity-link rollout 完成、Phase 3 writers 就緒。
9. 切換流量，啟用 trusted Company SSO → identity-link resolver → CallerContext 與 capability-union authorization。
10. 確認支援 Phase 3 的 deployment 是唯一 canonical application writer。
11. 退出 maintenance，恢復 canonical writes。

具體指令如下；依正式資料庫 target 調整環境。註解保留英文，以便與英文手冊逐項對照：

```bash
# 1. Maintenance ON first: stop canonical writes to at least users,
#    workspaces, workspace_memberships, and every path that creates or
#    changes Workspace governance state. Read-only traffic may stay.
#    (Procedure is environment-specific; record it in the rollout ticket.)

# 2. Apply 008 (additive/compatibility schema; legacy rows backfill to TEAM).
npm run db:migrate -- --to 8

# 4. Explicit governance bootstrap: every legacy Team ends direct OWNER >= 1.
#    Owners come ONLY from the operator config; nothing is guessed from row
#    order, org_code, name, or member count.
npx tsx scripts/db/bootstrap-phase3-workspace-governance.ts --config /path/to/governance.json

#    governance.json shape:
#    { "owners": { "<workspace-id>": "<existing-hub-user-id>" } }
#    Unknown workspace/user targets, zero-member or all-EDITOR Teams without
#    an entry, and uncovered NULL/invalid role/source rows all fail closed.

# 5. Explicit trusted legacy identity-link bootstrap: the ONLY legacy-link
#    path. expected_emp_id is a safety assertion, never the link key;
#    duplicate/conflicting mappings fail closed; reruns are no-ops.
npx tsx scripts/db/bootstrap-phase3-identity-links.ts --config /path/to/identity-links.json

#    identity-links.json shape:
#    { "links": [{ "provider": "company-sso", "subject": "<opaque-subject>",
#                  "hubUserId": "<existing-hub-user-id>",
#                  "expectedEmpId": "<user-emp-id-safety-assertion>" }] }

# 6. Personal Workspace backfill (Task 7 implementation — NOT part of Task 4):
npx tsx scripts/db/backfill-personal-workspaces.ts --apply

# 7. Final constraints (migration 009: NOT NULL + CHECKs + canonical FKs).
#    009 beforeApply fails closed when governance bootstrap, Personal
#    backfill, or canonical shape is incomplete — no APPLIED ledger row is
#    written, the operator repairs the data (never the checksums) and reruns.
#    009 never auto-repairs rows and never reads operator input.
npm run db:migrate

# 8-11. Readiness → switch traffic → verify single writer → maintenance OFF.
#    Production boot must await verifyProductionReadiness() (server
#    composition) before serving traffic: 009 APPLIED + KM_IDENTITY_PROVIDER
#    = company-sso + wired server-side Company SSO session reader +
#    rollout-scope identity links complete (KM_COMPANY_SSO_ROLLOUT_USER_IDS,
#    comma-separated Hub UUIDs; unset means every existing Hub user).
#    The Phase-3-compatible deployment being the only canonical writer is
#    verified procedurally (no query can prove which deployments hold write
#    credentials) before maintenance is released.
#
#    WARNING: KM_ALLOW_LOCAL_IDENTITY_IN_PRODUCTION is a test/E2E-only opt-in
#    for booting `next start` with local identity. Never set it in a real
#    production deployment; production readiness still requires company-sso.
```

## 停寫契約（spec §15.1）

- 停寫必須從 **008 之前**開始，直到 **009 完成且 Phase 3 writer deployment 就緒**。不支援讓 Phase 0–2 writers 在 bootstrap 後繼續插入 Workspaces／Memberships，再直接套用 009。
- 此期間唯一允許的 canonical writers 是 migration runner、明確的 Phase 3 bootstrap scripts（`bootstrap-phase3-workspace-governance.ts`、`bootstrap-phase3-identity-links.ts`）、Personal backfill（`backfill-personal-workspaces.ts`，Task 7）與 system recovery tooling。
- `beforeApply` 的唯讀檢查不是 write fence；不能假設 legacy application 遵守 schema migration advisory lock。兩者都不能取代停寫。驗證報告必須記錄實際 maintenance／write-fence 程序，不能聲稱 migration lock 已阻止 application writes。

## Bootstrap 閘門（spec §15.3）

- Governance bootstrap 確認每個 Team 至少一位 direct OWNER，所有 membership role／source 有效且非 null。零成員 Team 必須明確指定既有 Hub User 為 OWNER。Personal backfill 在 008 的 `UNIQUE(personal_owner_user_id)` 下可重複執行。
- Company identity bootstrap 將範圍內每位既有人類 Hub user 連至可信任的 `(provider, subject)`；runtime 不以 emp_id 認領既有帳號。
- 所有 bootstrap／backfill 都在停寫期間完成，然後才套用 009。

## Migration 009 閘門（spec §15.4）

`009-phase-3-workspace-governance-finalize` 在任何 DDL 前，以唯讀方式重新驗證：

- 每個 workspace 有有效、非 null 的 type／lifecycle；TEAM 沒有 owner；PERSONAL 有既有 owner 且名稱為 `My Space`。
- 每個 membership 的 role／source 有效且非 null；`SYSTEM_PERSONAL` 必須是該 member 自己 PERSONAL workspace 內的 `OWNER`。
- 每個 TEAM 至少一位 direct OWNER。
- 每個 user 恰有一個 `My Space` PERSONAL workspace 與對應 `OWNER/SYSTEM_PERSONAL` membership（Personal backfill 輸出）。
- 沒有違反新 canonical User FKs 的孤立 `created_by`／`archived_by`／owner references。

最終 DDL 將 `workspace_type`／`role`／`membership_source` 設為 NOT NULL，加入 role／source／type／lifecycle／actor CHECKs、PERSONAL-shape coherence CHECKs、canonical `workspaces → users` FKs（owner／created／archived），並原樣保留 008 的 `UNIQUE(personal_owner_user_id)`。空資料庫可通過閘門；全新安裝直接遷移至 009。

## Rollback 與失敗處理

- 每個 bootstrap script 使用單一原子 transaction，相同 config 可安全重跑；相同 identity links 與已滿足的 governance entries 都是 no-op。
- 若任一步驟拒絕操作（fail closed），修正回報的 config／data 問題後重跑。不應在問題未解決時進入 009；009 閘門會拒絕。在 bootstrap 後寫入含 NULL Phase 3 欄位的 legacy row，必須使 readiness 失敗，不能默默 finalize。
- DDL 失敗保留 FAILED／RUNNING ledger diagnostics。明確修復 schema，只清除受影響的 ledger row；絕不修改 checksums。

## 整合 Company SSO 前的開發

本機開發使用 `KM_IDENTITY_PROVIDER=local` 與既有 `KM_LOCAL_*` 設定。Human Web 與 import API adapters 共用 `establishTrustedCaller()` bootstrap：解析 Hub identity、確保一個 My Space、建立攜帶可信任 claims 的 caller。Local claims 不含 company groups 或 platform capabilities。Task 13 的 navigation／admin UI 工作與此次 caller 改造分開。

沒有 company IdP 也可驗證 group authorization。Integration suite 將僅供測試的 `CompanySsoSessionReader` 傳給 `buildApplicationServices(isolatedPool, { companySessionReader })`，在隔離 MariaDB 上執行真實 request adapters、imports、Hub writes 與 governance。涵蓋 group-only EDITOR／ADMIN、direct VIEWER 加 group EDITOR／ADMIN、移除 mappings、archive 限制、authority ceilings，以及 writer 等待 Workspace lock 期間的撤權。Test sessions 不是正式登入實作，也沒有可傳入 identity／group claims 的 HTTP entry point。

## 後續接上 Company session adapter

在可信任的 server-side infrastructure 實作 `CompanySsoSessionReader.readSession()`，驗證目前 request 的 company login session，回傳 provider-issued subject、enterprise profile 與驗證後的 group IDs。重用 reader instance，不可快取使用者 session 或 claims。正式使用前仍須完成具體 company login／session 整合。

每個 serving runtime 的 startup composition，在任何 `applicationServices()` 呼叫前：

1. 設定 `KM_IDENTITY_PROVIDER=company-sso`、provider namespace、可選 team-create groups 與 rollout scope。
2. 從 `src/server/composition.ts` 呼叫一次 `configureCompanySsoSessionReader(companySessionReader)`；延遲或重複註冊會被拒絕。
3. 完成上述 migration／bootstrap，然後 await `verifyProductionReadiness()` 才開放流量。Readiness 使用與 request handling 相同的 provider settings 與 reader dependency，不能只傳另一個 reader 給檢查使它通過。

Company request bootstrap 也在解析使用者前強制 readiness。成功結果會依 application-services instance 快取；失敗後，operator 修復切換問題，後續 request 會重試。每次 bootstrap 都重新讀取 session claims。Reader 缺失、migration 009 未套用、必要 legacy identity link 缺失都 fail closed。本機開發路徑不要求 company readiness。

Content／import writers 在 Workspace lock 下，根據目前 direct-plus-group capabilities 授權 `document.write`／`source.manage`。Governance 的基本操作使用 effective ADMIN capabilities，audit access 使用 `audit.read`；group ADMIN 不能授予、降級或移除 OWNER／ADMIN authority。驗證這些政策不需接上 Company SSO。

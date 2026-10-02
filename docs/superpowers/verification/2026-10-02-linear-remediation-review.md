# Linear remediation — independent code review

日期：2026-10-02。基底：`1cf8114`。分支：`codex/linear-uiux-remediation`。

依使用者明確 invoked requesting-code-review skill 安排獨立 reviewer（`/root/independent_review`），提供 focused requirements、變更邊界與既有驗證紀錄。Reviewer 讀取 tracked diff 與新 source/scripts，沒有編輯檔案。Review 包含導航／portal／drawer、Composer／scroll／draft、Home query／ownership／authorization、action menus、revision diff、import batching 與設計 lint。

## Finding：手機 explorer 操作選單被 Drawer 攔截（P1，已修正）

觸發：390px viewport，打開 Menu → 文件列 Actions → 點 Add to favorites。

修正前 production Playwright regression 確認：menu item 可見且可被 accessibility role 查詢，但 pointer click 持續被 Drawer 的 `Document tree` nav 攔截，直到逾時。只檢查選單可見或鍵盤 focus 無法發現這個問題。

原因：explorer 在 KnowledgeLayout 中建立，portal 到 modal Drawer。Explorer menu 的 portal 仍位於 body，Base UI Positioner 的 transform 建立自己的 stacking context；只有內層 Popup 的 `z-50` 無法將整個 menu 提到 Drawer 之上。

修正：`src/components/ui/menu.tsx` 的 `MenuContent` 與 `ContextMenuContent` 將 `z-50` 加在 outer Positioner；caller 的 className 仍套用在 Popup。獨立 reviewer 核對此最小修正及其 stacking 行為。

## 驗證結果

新增兩個 regression scenarios，放在 `tests/e2e/linear-remediation.spec.ts`：

1. 手機 Document display options：menuitemcheckbox 可見，ArrowDown 可以取得焦點，Escape 關閉 menu 後返回 trigger，Drawer 保持開啟。
2. 文件列一般 menu 可以加入收藏，context menu 可以移除收藏；New folder input 自動取得焦點，Escape 只關閉上層 folder dialog 並保留 Drawer；重新開啟後可輸入並成功建立資料夾。

上述兩個情境在正式 build 與隔離 DB 中通過。另重跑核心 UI、keyboard shortcuts、recents/favorites：31 個情境通過。新增 row-action test 初次因舊 menu 的關閉動畫仍在 DOM，立即開啟 context menu 時 locator 同時匹配兩個 item；補上等待舊 menu 關閉後，完整情境通過。合計 32 個不同 browser 情境有修正後成功證據，分批驗證，沒有將先前失敗的整批宣稱為一次全部通過。

相關 unit tests：`ui-primitives`、`ui-feedback-primitives`、`linear-remediation`，3 files／45 tests 通過。Production build、最後 TypeScript、ESLint 與 `git diff --check` 通過。

## Review 結論與界限

確認一項手機操作阻擋 regression，已修正並補上 pointer interaction coverage。Reviewer 沒有再確認其他 consequential defects。最初對 Base UI focus context 的疑點，經顯示選單與 folder dialog 的焦點／Escape／送出實測，未重現焦點管理故障。

Home summary 的 archived ancestor filtering 與原本 listTree 語意相同，沒有列為這次引入的問題。此 review 不代表完成全路由 screen-reader、Company SSO browser 或全部 viewport/theme 矩陣，沿用 [實作驗證紀錄](2026-10-02-linear-remediation-verification.md) 的界限。

Review 完成時，尚未 commit、push、建立 PR 或 merge。測試 DB 與 server 由 harness 結束後清理。

# 全頁面引導與說明文字掃描

日期：2026-10-09（Asia/Taipei）

範圍：31 個 page.tsx 路由及主要呈現元件。檢查常駐教學、重複說明、條件顯示與收合行為。這是原始碼層級的內容審查，並非所有頁面與所有資料狀態的瀏覽器視覺驗收。文件正文、診斷結果、實際資料與操作限制不以字數直接判為冗餘。

## 優先調整

| 優先 | 頁面 | 發現與證據 | 建議 |
|---|---|---|---|
| 高 | Sources | `freshness-reminders.tsx` 在沒有需提醒的來源時仍顯示標題、門檻選擇、完整機制說明與「No folders need…」。Sources 頁面無條件呈現個人提醒設定，包括沒有來源時。 | 沒有 folder source 時隱藏；有需提醒來源時顯示提醒；門檻設定與機制說明移入收合設定，保留可找到的設定入口。 |
| 高 | Import folder | 頁面第二段與 `sample-wiki-import.tsx:51` 重複「Not sure what a folder should look like?」；表單在選擇資料夾之前堆疊跳過規則、Import scope 摘要與 Excluded paths 區塊。 | 上方保留一行「Choose a folder, review Preview, then Apply」與格式指南連結；sample 區塊只保留名稱與動作；預設跳過規則整合進 Excluded paths 的說明。 |
| 高 | Update from folder | page.tsx 的「Re-select the full folder to preview the next sync」與 `folder-import-form.tsx:621` 重複。頁首還常駐 Sync version。 | 重選完整資料夾的指示只保留一次；同步版本移至來源技術詳情。保留尚未 Apply 的狀態說明。 |
| 中 | Graph | `graph-explorer.tsx:159` 同一常駐 status 段落包含 Find 行為、Orphans 與 Unresolved 定義，即使使用者沒有搜尋也出現。 | 搜尋時保留匹配數與簡短結果行為；名詞定義改放各篩選器可用鍵盤開啟的說明或收合說明，不以只支援 hover 的提示取代。 |
| 中 | Copy for Agent | `agent-context-builder.tsx` 頂部說明流程、20 文件與 256 KiB 限制，空的 Selected documents 區塊再次說明 Select → Prepare → Review。 | 頂部保留流程一次；空選取只顯示「Select documents from the list」。限制保留在選取數量與準備按鈕旁，不能刪除到使用者看不到。 |
| 中 | Source health 總覽 | 頁首 description 與下方常駐段落都在說明選擇 folder、檢查 links／warnings。 | 合併為一句；Incomplete index 說明只在實際發生時顯示（個別來源 health 已如此處理）。 |
| 中 | Import preview | page.tsx 使用「immutable staged diff」技術敘述且常駐教學連結；`import-preview.tsx:102` 即使規則未變也展開列出所有 excluded paths 和預設 skip 說明。 | 頁首改為簡短操作說明；正常 import scope 只顯示排除數，完整 paths 收合。規則改變、被 archive 文件、blockers、過期與 stale 警告必須可見。 |
| 低 | Insights | 已有收合的 How counts work，Recent changes、Sync overview 仍各有常駐統計定義，Reading activity 也有時區文字。 | 可把重複的計數定義移入既有 How counts work；期間與時區保留簡短標示，legacy／尚未 tracking 警告維持條件顯示。 |

## 建議保留

- Home：首次引導可隱藏；空工作區有恢復入口，有文件時不新增提示列。若已加入 onboarding 的使用者之後匯入文件，引導仍可持續顯示，這是保留進度的現有行為，不建議本次擅自自動隱藏。
- Knowledge／Search／Updates／Shares：說明主要出現在無資料、無結果、篩選無結果或權限不足時，負責提供下一步；不應用整頁刪字取代。
- Search：Advanced filters、Saved searches 已收合，作用中的篩選才展開，主結果不被長教學占用。
- 文件閱讀／編輯／新建：Technical IDs 收合；標題缺失、檔案標題、改名、草稿還原、未儲存內容等提示與當下狀態有關。
- Source detail／Sync run：Technical details、diff 與 sync summary 收合；成功結果、歷史記錄不足和診斷屬於狀態資訊。
- Settings：新增成員與 group mapping 已收合；直接權限與 SSO 權限差異、Archive 後的效果應保留。
- Help／Import guide：使用者主動進入的閱讀頁，完整教學合理，不納入「常駐教學過多」。
- 公開分享：正文與來源／時間資訊，沒有另外堆疊入門教學。

## 路由覆蓋

- `/`：導向路由，沒有獨立說明版面。
- `/s/[token]`：未發現需優先移除的常駐教學；保留狀態與操作提示。
- `/w/[workspaceId]/agent-context`：建議合併重複流程說明。
- `/w/[workspaceId]/graph`：建議縮短常駐篩選器定義。
- `/w/[workspaceId]/help`：主動閱讀的指南，保留完整說明。
- `/w/[workspaceId]/home`：未發現需優先移除的常駐教學；保留狀態與操作提示。
- `/w/[workspaceId]/knowledge/[sourceId]/[documentId]/edit`：未發現需優先移除的常駐教學；保留狀態與操作提示。
- `/w/[workspaceId]/knowledge/[sourceId]/[documentId]`：未發現需優先移除的常駐教學；保留狀態與操作提示。
- `/w/[workspaceId]/knowledge/[sourceId]`：未發現需優先移除的常駐教學；保留狀態與操作提示。
- `/w/[workspaceId]/knowledge/new`：未發現需優先移除的常駐教學；保留狀態與操作提示。
- `/w/[workspaceId]/knowledge`：未發現需優先移除的常駐教學；保留狀態與操作提示。
- `/w/[workspaceId]/link-check`：導向路由，沒有獨立說明版面。
- `/w/[workspaceId]/profile/articles`：未發現需優先移除的常駐教學；保留狀態與操作提示。
- `/w/[workspaceId]/profile`：低優先：重複計數定義可移入既有收合區。
- `/w/[workspaceId]/profile/sync`：未發現需優先移除的常駐教學；保留狀態與操作提示。
- `/w/[workspaceId]/search`：未發現需優先移除的常駐教學；保留狀態與操作提示。
- `/w/[workspaceId]/settings/audit`：未發現需優先移除的常駐教學；保留狀態與操作提示。
- `/w/[workspaceId]/settings/groups`：未發現需優先移除的常駐教學；保留狀態與操作提示。
- `/w/[workspaceId]/settings/members`：未發現需優先移除的常駐教學；保留狀態與操作提示。
- `/w/[workspaceId]/settings`：未發現需優先移除的常駐教學；保留狀態與操作提示。
- `/w/[workspaceId]/shares`：未發現需優先移除的常駐教學；保留狀態與操作提示。
- `/w/[workspaceId]/sources/[sourceId]/health`：未發現需優先移除的常駐教學；保留狀態與操作提示。
- `/w/[workspaceId]/sources/[sourceId]`：未發現需優先移除的常駐教學；保留狀態與操作提示。
- `/w/[workspaceId]/sources/[sourceId]/runs/[runId]`：未發現需優先移除的常駐教學；保留狀態與操作提示。
- `/w/[workspaceId]/sources/[sourceId]/update`：優先合併重選資料夾指示。
- `/w/[workspaceId]/sources/health`：建議合併頁首重複介紹。
- `/w/[workspaceId]/sources/import/guide`：主動閱讀的指南，保留完整說明。
- `/w/[workspaceId]/sources/import`：優先合併重複入門／範例說明。
- `/w/[workspaceId]/sources/imports/[snapshotId]`：精簡頁首與一般排除規則；保留 Apply 決策資訊。
- `/w/[workspaceId]/sources`：優先精簡 freshness 常駐說明；回報區塊已移除。
- `/w/[workspaceId]/updates`：未發現需優先移除的常駐教學；保留狀態與操作提示。

## 本次完成的回報入口驗證

Report a problem 從 Sources 底部移至共用帳號選單 Help & guides 下方。對話框保留下載方式、目前路徑及不自動送出的說明，支援 Escape、Close 與返回觸發按鈕焦點。

驗證通過：正式 production build、TypeScript、修改檔案 ESLint、5 個相關 unit tests、1 個 browser E2E（Sources 移除、帳號選單開啟、空描述禁用下載、Escape／focus、Graph 頁面下載與 Close），Impeccable detector 無發現。

掃描時尚未修改上述頁面；下列建議已於使用者確認後實施。

## 已實施的調整

- Sources：無 active folder source 時不呈現 freshness；設定與機制說明收合，無提醒時不呈現空提醒列。
- Import：合併頁首操作流程及格式指南；移除 sample 重複段落；預設跳過規則與保存說明移入 Excluded paths，摘要只保留排除數。
- Update：完整資料夾選擇提示只在表單出現一次；同步版本沿用來源 Technical details。
- Graph：Find 行為與匹配數維持可見，篩選器定義移入 About graph filters。
- Agent context：流程保留一次，選取區只提示選擇文件；20 文件與 256 KiB 限制放在 Prepare context 旁。
- Source health：合併頁首介紹。
- Import preview：簡化頁首，Preview help 及完整排除路徑收合；排除規則變更、blockers、stale 和過期提示維持可見。
- Insights：重複計數定義移入既有 How counts work。

驗證：79 個相關單元測試、TypeScript、修改檔案 ESLint、production build 通過。5 個瀏覽器測試通過（Freshness 設定保存及手機無橫向溢位、Graph／回報流程、中英文範例 Preview→Apply→閱讀與 wikilinks、格式指南入口）。檢視 Sources 桌面與 390px 手機截圖，收合設定及提醒操作正常。其他調整頁面尚未逐頁完成視覺截圖驗收。機械設計偵測未發現問題。

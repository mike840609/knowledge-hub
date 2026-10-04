# README 截圖來源紀錄

[English](README.md) | **繁體中文**

這些截圖於 **2026-10-05（Asia/Taipei）**，在 fetch 並快轉至 remote main [`3739efb12906e1cb2e6abc1b5eea7727914a08ab`](https://github.com/mike840609/knowledge-hub/commit/3739efb12906e1cb2e6abc1b5eea7727914a08ab) 後，使用全新 production build 擷取，取代原 README 的 October 2 截圖。

- Build ID：`p61B410H6oSgHi5044IHC`。`npm run build` 通過，包含 lint 與型別檢查。
- Runtime：`next start`，僅綁定 loopback。此截圖工作階段啟用 local test identity，不是正式部署設定。
- 應用 components 與 tests 與此 main commit 相同。唯一 local source change 是 `src/app/layout.tsx` 的中立瀏覽器標題與描述，不改變頁面配置。
- 帳號為獨立的 **Documentation Demo** local persona。四份文件都是合成英文範例，沒有使用既有私人筆記。
- Viewport：767 × 951、light theme、響應式配置。圖片為未修改的 browser JPEG。
- 已確認 Home、Engineering handbook reader、source detail／history、Graph 的內容與導覽正常，沒有 framework error overlay。工作階段記錄過一筆 React hydration 警告（#418）；此紀錄不宣稱瀏覽器完全沒有警告。

| 圖片 | 內容 |
| --- | --- |
| `personal-home.jpg` | My Space 概覽、同步資料夾、未讀更新與個人筆記 |
| `document-reader.jpg` | 合成手冊、展開目錄、wikilinks 與 backlinks |
| `source-history.jpg` | Source-managed folder 概覽與成功匯入歷史 |
| `knowledge-graph.jpg` | 四份文件與五條連結 |

[機器可讀紀錄](capture.json) 保存 commit、build ID、viewport 與每張圖片的 SHA-256。`docs/ui-comparisons/` 的歷史 before／after 圖片是原功能 PR 的證據，並非 README 這次使用的最新截圖。

日後替換時，重新 fetch main、建置該 checkout、使用獨立合成帳號、等待內容完成渲染、逐張檢查圖片，並同步更新雙語 README 與 metadata。截圖屬於 repository license 授權的專案文件。

# Linear 對齊改善設計

[English](2026-10-02-linear-remediation-design.md) | **繁體中文**

October 2 audit 是 backlog，baseline 為 main `1cf8114`。使用者授權按建議順序實作。保留既有 typography、semantic light／dark palette、authorization、ownership、drafts、revisions、shortcuts 與 knowledge model。

## 導覽與撰寫

Desktop 保留獨立導覽區：primary rail 展開 160px、收合 48px，contextual explorer 獨立寬 288px。Explorer 從 global header 下方頂端開始，primary navigation 收合時維持完整高度；⌘\ 保留原 binding。Topbar 保留原 brand／collapse 區、獨立 workspace selector，再接 Search；desktop 前兩區與 rail／explorer 對齊。Reader 與 composer 保留同一 outline column。窄螢幕用單一左側 Menu drawer 包含 primary navigation 與 explorer。CSS 在 hydration 前隱藏 desktop explorer。只使用一個 explorer instance，透過 portal 在 desktop 與 mobile drawer 間切換，保留 route contexts，避免 duplicate IDs／state。

Reader 與 composer 使用 DocumentPane，保留相同 outline geometry。Composer breadcrumb、Save／Cancel／Markdown actions 與 draft state 在其 scroll container 內保持可見。Header 在小螢幕換行。Reader 文件 header 捲離後，contextual Edit／Share／Details 仍在 topbar 可用。Source detail 採用 PageHeader。

## 日常操作

Home 優先呈現 drafts、recent work、favorites。Organize 與 Export 移至 More menu，開啟時顯示 export scope。Document rows 重用 action-registry menus 與 accessible focus treatments，phone 使用 compact metadata。空 draft／favorite 說明不應主導首屏。Palette 優先保留 recent documents；空 query 不列出重複的 current-section navigation，接著優先 document actions。Sources 採用共用 arrow-key list navigation，不取代 native links。

介面既有語言為英文；新 operational copy 與受影響混合語言 composer messages 都使用英文。Technical diagnostic codes 與 raw audit names 移至 details，主要文字說明問題與下一步。Unknown values 提供可讀 fallback，保留 raw value 供調查。

## 規模與歷史

Home 從具 authorization 的 read service 取得 document summaries，不逐份查詢 revision。Import groups 與 diagnostics 用 bounded batches，提供明確 Show more。Version comparison 呈現 changed lines 與 counts，保留 raw Markdown 與 restore-as-new-revision semantics。Static checks 強制使用非 arbitrary type／radius／rhythm values，geometry exceptions 必須記錄；Tailwind 本身仍允許 arbitrary values。

## 驗證與停止範圍

確認長 public share scrolling 與 title ownership、兩個主題下 compiled controls／hint contrast、desktop／mobile navigation／drawers／pane geometry、長文件 Save／drafts／conflict、palette／row keyboard behavior、bounded import presentation、authorized summary reads、revision diff。執行相關既有 checks，必要時加入 behavioral regressions。F13 已在 main 實作。F16 仍為可選比較：除非比較顯示明確閱讀優勢，刻意保留既有 cool neutral palette；不要求 rebrand。

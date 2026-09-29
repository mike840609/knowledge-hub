# Personal Workspace 知識連結與圖譜 — 實作計畫

| 項目 | 內容 |
| --- | --- |
| 日期 | 2026-09-29 |
| 設計規格 | [`2026-09-29-personal-workspace-knowledge-graph-design.md`](../specs/2026-09-29-personal-workspace-knowledge-graph-design.md)（以下 §n 都指它） |
| 前置 | Phase 0–5、文件分享連結、keyboard shortcuts（PR #52–#60）已在 `main` |
| 基準 | 開工前：unit 427、integration 444 全綠；`tsc --noEmit`、`eslint .` 乾淨 |
| 分支 | `claude/keen-cannon-7axign`；每個切片一個 commit 系列，可獨立回退 |

## 0. 共同規則

- **每個切片結束時**都跑 `make verify`（unit + typecheck + lint + build）；涉及 DB 的切片另跑 `make test-integration`；涉及畫面的切片另跑對應 e2e（`make test-e2e` 需要 `make browsers` 與本機 MariaDB）。
- **先寫測試再寫實作**適用於所有純函式（抽取、slug、解析、圖、layout）——它們是這份計畫的核心風險所在，也是最容易用測試釘住的部分。
- **只用 token 名稱**（`text-body`、`rounded-md`、`shadow-popover`…）；`tests/unit/design-tokens.test.ts` 與 `eslint.config.mjs` 會擋掉越界的寫法。
- **不新增產生 revision 的路徑而不掛索引**；`tests/integration/link-index-write-points.test.ts`（切片 2）掃描原始碼強制這點。
- 每個切片結束更新 §Verification 表（本檔末），最後產出 verification 紀錄。

## 1. 切片 1 — TOC 與標題錨點（無資料變更）

| # | 任務 | 檔案 | 測試 |
| --- | --- | --- | --- |
| 1.1 | 明確宣告 `unified`、`remark-parse`（版本與 lockfile 內現有的一致），共用解析設定 `parseMarkdown(markdown)`（remark-parse + remark-gfm） | `package.json`、`src/shared/markdown/parse.ts` | `tests/unit/markdown-parse.test.ts` |
| 1.2 | `headingSlug`、`assignHeadingSlugs(tree)`（GitHub 相容、CJK、重複後綴） | `src/shared/markdown/heading-slug.ts` | `tests/unit/heading-slug.test.ts`：英文、CJK、標點、重複、空、超長、含行內 code／強調／GFM 刪除線 |
| 1.3 | `extractOutline(markdown)`（深度 1–4、上限 200、縮排深度） | `src/shared/markdown/outline.ts` | `tests/unit/markdown-outline.test.ts`：跳級標題、code fence 內的 `#`、setext 標題、空文件 |
| 1.4 | `remarkHeadingIds` plugin 掛進 `MarkdownRenderer`；標題加 `scroll-mt-4` | `src/components/knowledge/markdown-renderer.tsx` | `tests/unit/markdown-renderer-headings.test.tsx`：渲染結果的 `id` 與 `extractOutline` 逐項相等 |
| 1.5 | `useActiveHeading(ids, scrollRoot)`（IntersectionObserver）、`DocumentOutline`（`nav`＋`ol`、`aria-current`、reduced motion） | `src/components/knowledge/use-active-heading.ts`、`document-outline.tsx` | 元件以 `react-dom/server` 渲染的結構測試；捲動同步在 e2e |
| 1.6 | 版面：rail（`min-[1280px]`、inspector 關閉時）、inspector「Outline」分頁、窄螢幕 `<details>`；文件頁把選定 revision 的 outline 傳下去 | `document-inspector.tsx`、`[documentId]/page.tsx`、`document-viewer.tsx` | e2e `tests/e2e/document-outline.spec.ts` |
| 1.7 | 掃描現有 `id=` 用法確認與標題 id 無衝突（§15 風險） | — | 一次性檢查，結果記在 verification |

**驗收：** 見 §13 切片 1。`make verify` 綠；e2e：四個標題的文件出現四項目錄、點第三項後 `location.hash` 變更且該標題在視窗內、`<2` 個標題不出現目錄、歷史 revision 顯示該版目錄。

## 2. 切片 2 — 連結模型與索引（migration 012）

| # | 任務 | 檔案 | 測試 |
| --- | --- | --- | --- |
| 2.1 | Domain：`extractDocumentLinks`、`ExtractedLink`、`LINK_EXTRACTOR_VERSION`、限制常數 | `src/modules/knowledge/domain/document-links.ts` | `tests/unit/document-links-extract.test.ts`：§5 規則表逐列（wikilink 各形態、alias、fragment、`#^block`、embed 忽略、code／inline code／html 內忽略、GFM 表格內 `\|`、相對 `.md`、URL 編碼、外部／非 md／純錨點忽略、上限、行號、順序） |
| 2.2 | Domain：`normalizeLinkKey`、`buildResolver(catalog)`（`resolveWiki`、`resolvePath`）、決定性排名 | `src/modules/knowledge/domain/link-resolution.ts` | `tests/unit/link-resolution.test.ts`：標題／檔名主幹、路徑後綴、同 Source 優先、完全相同優先、tie-break 全序、相對路徑 `..`、跳出根、不分大小寫退而求其次、自連結、封存不在目錄 |
| 2.3 | Migration `012-document-link-index`（§7.1）；登記到 `migrations/index.ts` | `migrations/012-document-link-index.ts`、`index.ts` | `tests/integration/link-index-schema.test.ts`：表與 FK、`ck_kind`、`RESTRICT`、標記列缺失時子列插入被拒；`phase1-migration-runner` 的版本清單同步 |
| 2.4 | Port `DocumentLinkRepository`（`replaceForDocument`、`loadCatalog`、`loadValidEdges`、`countIndexState`、`listStaleDocuments`、`loadCurrentMarkdown`）與 MariaDB 實作；加進 `KnowledgeRepositories`／`createRepositories` | `ports/document-link-repository.ts`、`repositories/document-links.ts`、`ports/unit-of-work.ts`、`repositories/index.ts` | `tests/integration/link-index-repository.test.ts`：替換而非累加、`link_count` 一致、有效性（revision 不符／版本過期）、catalog 只含 ACTIVE 且限定 Workspace |
| 2.5 | 四個寫入點掛上 `links.replaceForDocument`（NOOP 不重建） | `create-document.ts`、`create-revision.ts`、`source-knowledge-projection-service.ts`（兩處） | `tests/integration/link-index-write-points.test.ts`：四條路徑各一；再掃描原始碼，`revisions.insert(` 的檔案必須同時含 `links.replaceForDocument`；`phase2-import-apply-perf` 的 stub 補上 `links` |
| 2.6 | 抽出 `requireVisibleDocument`（行為不變），`KnowledgeQueryServiceImpl` 改用它 | `application/internal/require-visible-document.ts`、`knowledge-query-service.ts` | 既有 `phase1-query`、`phase1-workspace-access` 不改動仍綠 |
| 2.7 | `KnowledgeLinkService.getDocumentLinks`（outgoing 現算、backlinks 由邊、context、index state）；註冊到 composition root | `application/knowledge-link-service.ts`、`src/server/composition.ts` | `tests/integration/knowledge-link-service.test.ts`：非成員被拒；跨 Workspace 連結不解析且與「不存在」不可區分；封存來源不出現在 backlinks；歷史 revision 的 outgoing；context 截斷；`SOURCE_MANAGED` 來源的連結同樣被索引 |
| 2.8 | `scripts/db/reindex-document-links.ts`、`npm run db:reindex-document-links`、`make db-reindex-links`；`db:migrate` 尾端提示 | `scripts/db/`、`package.json`、`Makefile` | `tests/integration/link-index-reindex.test.ts`：清空索引後 reindex 全數還原；冪等；與同時進行的存檔競爭時，索引永遠對應最後成為目前的那個 revision（鎖住文件後才讀 revision） |
| 2.9 | 營運說明：部署順序與 reindex（migration → reindex → 開放） | `docs/operations/document-link-index-rollout.md` | — |
| 2.10 | Domain：圖與 backlink 建構器（`resolveEdges`、`buildWorkspaceGraph`、`buildLocalGraph`、`backlinksTo`）與 `linkContext`——原本排在切片 4，因為 service 需要而提前 | `link-graph.ts`、`link-context.ts` | `link-graph.test.ts`、`link-context.test.ts` |

**驗收：** 見 §13 切片 2。`make verify` 與 `make test-integration` 綠。

## 3. 切片 3 — 連結渲染與 Backlinks

| # | 任務 | 檔案 | 測試 |
| --- | --- | --- | --- |
| 3.1 | `remarkKnowledgeLinks` plugin：把 `[[…]]` 變成帶 `data-kh-wikilink` 的 link 節點；`MarkdownRenderer` 新增可選 `links` prop（key → 解析結果）；無 `links` 時輸出純文字 | `src/shared/markdown/remark-knowledge-links.ts`、`markdown-renderer.tsx` | `tests/unit/markdown-renderer-links.test.tsx`：resolved／unresolved／ambiguous 三種輸出；alias、fragment→`#slug`；相對 `.md` 連結；無 `links` 時純文字；code 內不轉換；`data-*` 屬性確實傳到 `a` 元件 |
| 3.2 | 文件頁呼叫 `getDocumentLinks`，把解析結果傳給 viewer；`getKnowledgeDocumentModel` 之外新增 `getDocumentLinkModel` | `src/server/link-graph-read.ts`、`[documentId]/page.tsx`、`document-viewer.tsx` | e2e |
| 3.3 | `DocumentLinksPanel`（inspector「Links」分頁：Backlinks／Outgoing／Unresolved；索引更新中提示） | `document-links-panel.tsx`、`document-inspector.tsx` | 結構測試 + e2e |
| 3.4 | `BacklinksFooter`（「Linked from N documents」，含上下文） | `backlinks-footer.tsx` | e2e |
| 3.5 | 動作註冊表：`document.backlinks`（僅 palette）；`kh:request-details` 事件帶 `tab`，inspector 分頁改為受控 | `action-registry.ts`、`action-menu.tsx`、`document-inspector.tsx` | `tests/unit/action-registry.test.ts`（+5） |
| 3.8 | 跨文件標題錨點：Next client navigation 在文件仍是 Suspense 骨架時就結束 hash 捲動，改為文件掛載後依網址 hash 捲到標題（e2e 發現） | `use-scroll-to-hash.ts` | `document-links.spec.ts` 第 4 案 |
| 3.6 | 分享頁維持純文字，並加守門測試：`s/[token]` 樹不 import 連結服務 | `tests/unit/share-link-single-exception.test.ts`（新增一項） | 同左 |
| 3.7 | seed fixtures：Query Master 內加幾份互相連結的文件，供 e2e 與手動驗證 | `scripts/db/seed.ts` | e2e |

**驗收：** 見 §13 切片 3；`tests/e2e/document-links.spec.ts`。

## 4. 切片 4 — 圖譜

| # | 任務 | 檔案 | 測試 |
| --- | --- | --- | --- |
| 4.1 | 明確加入 `d3-force`（僅 server 使用）與 `@types/d3-force` | `package.json` | — |
| 4.2 | Domain：`buildWorkspaceGraph`（節點、合併邊、degree、orphan、unresolved 節點、上限與 truncated）、`buildLocalGraph`（BFS、深度、60 節點上限） | `src/modules/knowledge/domain/link-graph.ts` | `tests/unit/link-graph.test.ts` |
| 4.3 | `layoutGraph`（固定種子、依 id 排序、固定 tick） | `src/lib/graph/layout.ts` | `tests/unit/graph-layout.test.ts`：同輸入同座標、有限數值、無重疊下限、單節點／空圖、1000 節點時間上限 |
| 4.4 | `KnowledgeLinkService.getWorkspaceGraph`／`getLocalGraph` | `knowledge-link-service.ts` | `tests/integration/knowledge-link-graph.test.ts`：授權、Source 過濾、封存排除、跨 Workspace 不出現、上限 |
| 4.5 | `GraphCanvas`（SVG、平移、縮放、hover 高亮、SVG `<a>` 節點）、`GraphControls`、`GraphListView` | `src/components/knowledge/graph-*.tsx` | 結構測試 + e2e |
| 4.6 | 頁面 `/w/[workspaceId]/graph`（search params：`source`、`orphans`、`unresolved`、`focus`）、`loading.tsx`、錯誤邊界 | `src/app/w/[workspaceId]/graph/` | e2e |
| 4.7 | inspector Local graph、「Open in graph」；主導覽「Graph」；`navigate.graph` 動作 | `document-links-panel.tsx`、`primary-nav.tsx`、`action-registry.ts` | 更新 registry 測試 |
| 4.8 | 空狀態、索引更新中、truncated 提示 | `graph-*.tsx` | e2e |

**驗收：** §13 切片 4 與整體驗收場景；`tests/e2e/knowledge-graph.spec.ts`。

## 5. 收尾

- README「目前狀態」與「Current canonical documents」加入本規格與本計畫；roadmap 的文件狀態表加一列；`CLAUDE.md` 在 Invariants 之後加一小段（連結索引是 derived data、新增產生 revision 的路徑必須掛索引）。
- Frontend Design Language §18：第 1 項（palette 只有導航）補記新增的兩個動作；不改其他。
- verification 紀錄 `docs/superpowers/verification/2026-09-29-personal-workspace-knowledge-graph-verification.md`：每個切片跑了什麼、結果、量測數字（§14）、未達成的項目。

## Verification（隨進度填寫）

| 切片 | unit | integration | e2e | build | 備註 |
| --- | --- | --- | --- | --- | --- |
| 1 TOC | 462（+35） | 不受影響 | `document-outline.spec.ts` 4/4 | 通過 | 1.7 已檢查：應用程式自有 id（`tree-filter`、`search-q` 等）可能與標題 slug 相同，outline 改在 `article` 內查找，不用全頁 `getElementById` |
| 2 索引 | 主要新增：extract 28、resolution 25、graph 19、context 8、write-points 2 | 467 → 485（link-index 15、reindex 5、service 18，含既有 444） | 不受影響 | 通過 | 效能測試 stub 補上 `links` 並斷言每份文件恰一次索引寫入（已驗證移除 hook 會失敗） |
| 3 渲染／Backlinks | 主要新增：renderer links 19、registry +5、shared-page guard +1 | 不受影響 | `document-links.spec.ts` 5/5（含真實 `/s/:token` 無 `/w/` 連結）＋ outline 4/4 | 通過 | 畫面已目視確認（rail、resolved／unresolved 連結、Linked from、Links 分頁）；folder-sync 相對 `.md` 連結由 integration 覆蓋，未做 e2e 匯入流程 |
| 4 圖譜 | | | | | |

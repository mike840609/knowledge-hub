# Personal Workspace 知識連結與圖譜 — 設計規格

| 項目 | 內容 |
| --- | --- |
| 日期 | 2026-09-29 |
| 類型 | 設計規格，供實作前審查 |
| 範圍 | 文件目錄（TOC）、雙向連結（`[[wikilink]]` 與相對 `.md` 連結、Backlinks）、關聯圖譜（Local / Workspace graph），以及其後的個人知識工作流待辦（§16） |
| 修改的契約 | 無。新增一份**可重建的 derived index**；不改變 scope、authorization、ownership、lifecycle 任何一條不變式（§12） |
| 接續／收回的既有決定 | Phase 2.5 §3 把「Internal wiki-link resolution」列為非目標；本規格收回其中的 wikilink 解析，`Obsidian-specific rendering extensions` 中的 callout、embed 仍不做（§2） |
| 對照文件 | Phase 3 governance spec §3–§5（My Space）、Phase 5 authoring spec、文件分享連結規格、動作模型規格、`frontend-design-language.md` |
| 狀態 | **已實作（四個切片，§13）。** §15 列出需要拍板的項目與建議預設；實作依預設進行，任何一項改動都只影響該項所在的切片。驗證紀錄：`docs/superpowers/verification/2026-09-29-personal-workspace-knowledge-graph-verification.md` |
| 實作計畫 | `docs/superpowers/plans/2026-09-29-personal-workspace-knowledge-graph.md` |

## 1. 要解決的問題

產品是 personal-first：登入預設進 My Space，知識先在那裡寫成、匯入（Obsidian／LLM Wiki 產出的資料夾，Phase 3 spec §3.1 明寫 My Space 承接它們）。但今天的 My Space 只是「一棵樹加一頁一頁的閱讀器」——文件之間沒有關係，長文件沒有導覽。

對照個人知識工作區該有的能力，盤點現況（依程式碼，不依印象）：

| 能力 | 今天 | 缺口 | 本規格 |
| --- | --- | --- | --- |
| 長文件導覽（TOC） | 無。標題不帶 `id`，連 `[x](#section)` 這種站內錨點都無效 | 目錄、錨點、捲動同步 | **P0** §9 |
| 文件間連結 | `[[Note]]` 顯示成純文字；`[x](../Note.md)` 是一條會 404 的相對網址（`markdown-renderer.tsx` 的 `MarkdownLink` 原樣輸出 `href`） | 解析、導覽、失效提示 | **P0** §5–§6 |
| 反向連結（Backlinks） | 無 | 索引 + 讀取模型 + UI | **P0** §7–§8 |
| 關聯圖譜 | 無 | Local graph、Workspace graph | **P0** §10 |
| 從失效連結建立文件 | 無 | 沿用既有 create flow，帶入標題 | P1 §16 |
| 編輯時 `[[` 自動完成 | 無（編輯器是純 `textarea`，Frontend Design Language §18 第 3 項另有待決） | 需要標題查詢 | P1 §16 |
| Tags | frontmatter 進 `metadata`（folder import 會剝掉 frontmatter 存 `metadata` JSON），但沒有任何地方讀它 | 抽取、瀏覽、過濾 | P1 §16 |
| Favorites／Recents | 動作註冊表已有 `document.favorite`，`favorite` 目前寫死 `false` | 需要 per-user 持久化 | P1 §16 |
| Unlinked mentions | 無 | 需要全文查詢，可借 Phase 4 search | P1 §16 |
| 連結 hover 預覽、Daily notes、Properties 面板 | 無 | — | P2 §16 |

TOC、連結、Backlinks、圖譜是同一條鏈：**標題錨點**讓 `[[Note#Heading]]` 有落點；**連結抽取與解析**同時餵給 Backlinks 與圖譜。所以放在一份規格裡，但分四個可獨立交付的切片（§13）。

## 2. 非目標

- **Embed／transclusion**（`![[Note]]`）與 block reference（`[[Note#^id]]`）。`![[…]]` 維持原文顯示，不當成連結；`#^id` 的 block id 部分會被忽略，連結仍指向該文件。
- **Callout、Dataview 等 Obsidian 專屬語法。**
- **改寫其他文件的內容來維持連結。** 連結以名稱／路徑解析，文件改名後指向它的連結會變成 unresolved 而不是被改寫（理由見 §3 D10）。
- **跨 Workspace 連結。** 一條連結永遠只在起點文件所屬的 Workspace 內解析（§6.4）。
- **連結的權限。** 連結不授予任何東西：能不能打開目標，仍由 Workspace membership 決定（§12）。
- **即時協作、推送更新。** 讀取時計算，重新整理才看到新的 Backlinks。
- **圖譜的語意／向量關係。** 那是 Phase 8／Phase 9（Agent 導出的 relations）的範圍；本規格只處理**人寫下的明確連結**。索引之後可以成為 Phase 9 的輸入，但不是它的一部分，也不是它的 patch layer。
- **HTTP API／MCP 端點。** v1 只有 application service；Phase 7 的 MCP 直接重用它（§8）。

## 3. 決策摘要

| # | 決定 | 理由 |
| --- | --- | --- |
| D1 | 功能以 **Workspace 為單位**，每個呼叫者可讀的 Workspace 都有；My Space 是第一個驗收場景 | Query Master 的 fixture 就是把 Obsidian Wiki 放在 Team Workspace；只為 My Space 開功能得多寫一條 `workspaceType` 分支，且授權邊界本來就是 Workspace。圖譜有節點上限（D8）保護大型 Workspace。**若要限縮成只有 My Space，只需在兩個入口加條件，不影響資料模型。** |
| D2 | 索引只存**原始連結（raw edge）**，**解析在讀取時**、在記憶體裡做 | 解析結果取決於「目前有哪些文件、叫什麼名字、在哪個路徑」，而「移動或改名不產生 revision」（CLAUDE.md）。若把解析結果存起來，每次建立／改名／移動／封存文件都得級聯更新別的文件的邊；存 raw edge 則索引**只依賴 revision 內容**，而 revision 是 immutable |
| D3 | 索引是 **derived data、可整表重建**，不是 authorization truth | 與 Phase 4 的搜尋一致；刪掉重建不改變任何人能讀什麼 |
| D4 | 索引在**產生 revision 的同一個 transaction** 內維護（四個寫入點，§7.3），並提供 `db:reindex-document-links` 修復與回填 | 同 transaction 保證「有新 revision 就有對應的索引」；migration runner 只允許唯讀 `beforeApply`，不能回填資料，所以回填只能是腳本 |
| D5 | 語法子集：`[[Target]]`、`[[Target\|Alias]]`、`[[Target#Heading]]`、`[[#Heading]]`，加上指向 `.md`／`.markdown` 的相對連結 | 涵蓋 Obsidian 與一般 LLM Wiki 產出的實際寫法（folder import 存的是剝掉 frontmatter 的 body） |
| D6 | 連結只在同一 Workspace 內解析；跨 Workspace 一律 unresolved，且**不區分「不存在」與「存在但在別的 Workspace」** | 否則解析結果成為「別的 Workspace 有沒有這個標題」的 oracle |
| D7 | 圖譜 layout 在**伺服端**以 `d3-force` 計算（固定種子、可重現），瀏覽器只負責 SVG 繪製、平移、縮放 | 不把力導向模擬送進 client bundle；SSR 就是完整畫面；layout 是純函式，可單元測試。新增依賴 `d3-force`（僅 server 使用） |
| D8 | 圖譜節點上限 **1000**，超過時依 degree 取前 1000 並明示 | 力導向 SVG 在數千節點時不可用；孤立節點最先被捨去 |
| D9 | 分享頁（`/s/:token`）**不解析連結**，`[[X]]` 只顯示文字 | 匿名讀者沒有 Workspace 內容的存取權；解析成 `/w/…` 連結既無用又洩漏「存在」 |
| D10 | **不改寫內容**維持連結；改名後的失效連結出現在「Unresolved」清單 | `SOURCE_MANAGED` 內容本來就不能在 Hub 內改寫；`HUB_MANAGED` 的批次改寫會為每個受影響文件產生一個 revision，讓歷史失去意義。改寫式改名列在 §16 |
| D11 | 標題 `id` 採 **GitHub 相容 slug、不加前綴** | Obsidian／GitHub 匯入的文件本來就寫 `[x](#some-heading)`，相容才能不改內容就運作 |
| D12 | v1 **沒有 HTTP API**；server component 經 read model 呼叫 application service | 與現有 Knowledge 閱讀頁相同做法；Phase 7 再決定對外形狀 |

## 4. 使用流程

**閱讀（任何有讀取權的人）：**

```text
開啟一份有 ≥2 個標題的文件
→ 寬螢幕（≥1280px、inspector 關閉）：內容右側出現貼齊頂端的「On this page」，目前段落高亮
→ 窄螢幕：內容頂端一個可展開的「On this page」
→ 點項目：平滑捲到該標題（尊重 prefers-reduced-motion），網址列 hash 更新

內文中的 [[Query Master]]
→ 有對應文件：一般內部連結（樣式同站內連結）
→ 沒有：虛線底線的「失效連結」，tooltip「No document titled “Query Master” in this workspace」
→ 有多份同名：連到規則 §6.2 選出的那份，tooltip 標明還有 N 份同名

文件底部「Linked from N documents」：列出每份來源文件的標題、所屬 Source、連結所在那一行的上下文
inspector 的「Links」分頁：Backlinks / Outgoing / Unresolved + Local graph
```

**圖譜：**

```text
主導覽「Graph」（或 ⌘K →「Open graph」）→ /w/:workspaceId/graph
→ 全 Workspace 圖：節點是文件，邊是連結，節點大小依連結數
→ 過濾：Source、「Show orphans」、「Show unresolved」；搜尋框依標題高亮
→ 平移（拖曳背景）、縮放（滾輪與 + / − / Reset）、hover 高亮鄰居、點節點開啟文件
→ 「List view」：同樣資料的表格（無障礙替代，§10.5）

文件頁 inspector「Links」→ Local graph（該文件的 1 度／2 度鄰居）→「Open in graph」帶 ?focus=<documentId>
```

**寫作：** 不新增操作。在 Markdown 裡寫 `[[Title]]` 即可；存檔（新 revision）後索引隨同 transaction 更新，Backlinks 立即可見。

## 5. 連結語法與抽取

抽取是**純函式** `extractDocumentLinks(markdown): ExtractedLink[]`，放在 `src/modules/knowledge/domain/document-links.ts`（domain：無 I/O）。它與渲染共用同一個解析設定（同一份 mdast + GFM），否則索引看到的連結與讀者看到的連結會不一致。

```ts
type ExtractedLink = {
  kind: "WIKI" | "PATH";
  target: string;           // WIKI：名稱或 path/name，不含 #fragment、|alias；PATH：解碼後的相對路徑，不含 #fragment、?query
  fragment: string | null;  // 標題文字（WIKI）或錨點（PATH）；block id（^…）被丟棄
  display: string | null;   // WIKI 的 alias；PATH 的連結文字
  line: number;             // body 內 1-based 行號，供 Backlinks 顯示上下文
  ordinal: number;          // 出現順序，文件內唯一
};
```

| 規則 | 說明 |
| --- | --- |
| 解析範圍 | 文件的 body markdown（folder import 已剝掉 frontmatter，Hub 文件本來就沒有）。只掃 mdast 的 `text` 節點；`code`、`inlineCode`、`html` 裡的 `[[x]]` 不算 |
| WIKI 樣式 | `[[` target（到第一個 `#` 或 `\|` 為止）[`#` fragment（到 `\|` 為止）][`\|` alias] `]]`。target 與 fragment 前後空白去除，內部連續空白保留原樣（正規化在解析時做，§6.1） |
| `[[#Heading]]` | 站內錨點，**不是邊**；渲染成 `#slug` 連結 |
| Embed | 前面緊接 `!` 的 `[[…]]` 不處理（§2） |
| PATH 樣式 | mdast `link` 節點，`url` 無 scheme、不以 `//` 開頭，去掉 `#…`／`?…` 後以 `.md` 或 `.markdown`（不分大小寫）結尾。先 `decodeURI`（`My%20Note.md` → `My Note.md`），解碼失敗則保留原字串 |
| 其他連結 | 外部網址、非 `.md` 的相對路徑（圖片、附件）、純 `#錨點` 都不是文件連結，維持現有行為 |
| 上限 | 每份文件最多 **2000** 條；target 最長 **512** 字元（超過者略過）。這是資料量護欄，不是語意 |
| 自連結 | 抽取階段保留；讀取模型在解析後排除（§6.3） |

`extractorVersion`（初始 `1`）隨語法規則變動而遞增；索引列記錄它，`reindex` 據此找出過期的列（§7.4）。

## 6. 解析規則

解析是**純函式**，輸入「Workspace 的目錄（catalog）」與「起點文件」，同樣在 domain。

```ts
type CatalogDocument = {
  documentId: string;
  sourceId: string;
  title: string;                 // 目前 revision 的 title
  sourcePath: string | null;     // source_entries.source_path（相對 Source 根、以 / 分隔）；HUB 文件為 null
  createdAt: Date;
};
```

目錄只含 **ACTIVE 文件、ACTIVE Source、ACTIVE 樹節點**。封存的文件不是連結目標。

### 6.1 正規化

`normalizeLinkKey(s) = s.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase()`；比對目標名稱時另外去掉結尾的 `.md`／`.markdown`。標題是 `utf8mb4_bin` 儲存（大小寫敏感），所以「完全相同」優先於「正規化後相同」（§6.2 第 2 點）。

### 6.2 `[[Target]]`

1. 候選集合：
   - target 不含 `/`：`normalizeLinkKey(title) === key`，**或** `normalizeLinkKey(檔名主幹) === key`（檔名主幹＝`sourcePath` 最後一段去副檔名；Obsidian 的連結寫的是檔名，而 Hub 的 title 可能來自 frontmatter 或 H1，兩者都要能命中）。
   - target 含 `/`：`sourcePath`（去副檔名、正規化）等於 key，或以 `"/" + key` 結尾（路徑後綴比對，Obsidian 的「最短路徑」寫法）。
2. 多個候選時依序比較，取第一名：起點文件所在 Source 優先 → 與原文 target 完全相同（title 或檔名主幹）優先 → title 命中優先於只有檔名命中 → `sourcePath` 段數少者優先（HUB 文件視為 0）→ `createdAt` 早者優先 → `documentId` 字典序。**決定性**：同樣輸入永遠同樣輸出，不依賴查詢順序。
3. 結果 `{ status: "RESOLVED", documentId, ambiguousWith: 候選數 - 1 }` 或 `{ status: "UNRESOLVED" }`。

### 6.3 相對 `.md` 連結

只有起點文件有 `sourcePath`（來自 folder sync）才能解析；HUB 文件寫的相對 `.md` 連結一律 unresolved。以起點文件的目錄為基準做 posix 路徑正規化（處理 `.`、`..`；開頭 `/` 視為 Source 根；跳出根目錄者 unresolved），在**同一個 Source** 內找 `sourcePath` 完全相等的文件，找不到再以不分大小寫比對。

**排除自連結**：解析到起點文件自己的邊不進入 Backlinks 與圖譜。多條連結指向同一目標時合併成一條邊並記 `count`。

### 6.4 範圍

目錄只由**起點文件所屬 Workspace** 建立（一個 SQL join 到 `knowledge_sources.workspace_id`）。所以：跨 Workspace 連結不可能被解析；「另一個 Workspace 有這個標題」在任何輸出裡都看不出來。

## 7. 資料模型與維護

### 7.1 Schema（migration `012-document-link-index`）

```sql
CREATE TABLE knowledge_link_index (
  document_id UUID NOT NULL,
  revision_id UUID NOT NULL,                 -- 這些邊是從哪個 revision 抽出的
  extractor_version SMALLINT UNSIGNED NOT NULL,
  link_count INT UNSIGNED NOT NULL,          -- 必須等於 knowledge_document_links 的列數
  indexed_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (document_id),
  CONSTRAINT fk_link_index_revision FOREIGN KEY (document_id, revision_id)
    REFERENCES knowledge_revisions (document_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE TABLE knowledge_document_links (
  document_id UUID NOT NULL,
  ordinal INT UNSIGNED NOT NULL,
  link_kind VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,   -- WIKI | PATH
  target_text VARCHAR(1024) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  target_fragment VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  display_text VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  line_no INT UNSIGNED NOT NULL,
  PRIMARY KEY (document_id, ordinal),
  CONSTRAINT fk_document_links_index FOREIGN KEY (document_id)
    REFERENCES knowledge_link_index (document_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT ck_document_links_kind CHECK (link_kind IN ('WIKI', 'PATH'))
);
```

- **Scope 是推導的，不存兩次**：兩張表都沒有 `workspace_id`／`source_id`，Workspace 一律經 `Document → Source → Workspace` 取得（CLAUDE.md 第一條不變式）。
- 沿用全專案的 `ON DELETE RESTRICT`。「替換」用「先刪子列、再更新標記列、再插子列」完成，不依賴 cascade。
- 索引**每份文件一組**、對應**目前 revision**。歷史 revision 不建索引（不需要，也避免 revision 越多索引越大）。

### 7.2 有效性

一份文件的索引「有效」⇔ `knowledge_link_index.revision_id = knowledge_documents.current_revision_id` **且** `extractor_version = 目前版本`。讀取模型只使用有效的邊；無效或缺少標記列的文件計入 `staleDocuments`（§8.3）。這讓「沒有連結」與「還沒索引」可以區分——沒有標記列的文件不會被誤認為孤立節點。

### 7.3 寫入點（都在產生 revision 的同一個 transaction 裡）

| 路徑 | 位置 | 已持有的鎖 |
| --- | --- | --- |
| Hub 建立文件 | `create-document.ts` | Source、Workspace |
| Hub 新增 revision | `create-revision.ts`（`changed = false` 的 NOOP 不重建） | Source、Workspace、Document |
| Folder sync 建立文件 | `source-knowledge-projection-service.ts#projectDocument` | Source（Apply 交易） |
| Folder sync 新增 revision | `source-knowledge-projection-service.ts#projectRevision` | Document |

每處在 `setCurrentRevision` 之後呼叫 `repositories.links.replaceForDocument(...)`。抽取（純函式）在 call site 內做——`tests/unit/share-link-single-exception.test.ts` 要求 application 層每個碰 markdown 的函式都帶 `CallerContext`，這四個位置本來就有。**封存／還原文件、移動、改名不需要動索引**（索引只依賴 revision 內容，可見性在讀取時依狀態過濾）。

### 7.4 回填與修復

`npm run db:reindex-document-links`（`make db-reindex-links`）：找出無效或缺少標記的文件，逐份在自己的 transaction 內鎖住文件列、確認 `current_revision_id` 沒變、再替換索引。可重跑、可中斷。部署順序：migration 012 → 執行 reindex → 開放功能。**在 reindex 完成前，Backlinks 與圖譜會顯示「索引更新中（N 份文件）」而不是空白。** `db:migrate` 結束時若偵測到有未索引文件，印出提示。

## 8. 讀取模型與授權

`KnowledgeLinkService`（`src/modules/knowledge/application/knowledge-link-service.ts`），與 `KnowledgeQueryService` 同一套授權手法：方法第一個參數是可信 `CallerContext`，在同一個 unit of work 內 `requireMembership`；URL 參數只是導覽輸入。

```ts
interface KnowledgeLinkService {
  /** 一份文件的連結視圖：解析後的 outgoing、backlinks、unresolved。 */
  getDocumentLinks(caller, documentId, input?: { revisionNo?: number; includeArchived?: boolean }): Promise<DocumentLinkView>;
  /** 整個 Workspace 的圖。 */
  getWorkspaceGraph(caller, workspaceId, input?: { sourceId?: string; includeUnresolved?: boolean; includeOrphans?: boolean; limit?: number }): Promise<WorkspaceGraphView>;
  /** 以某文件為中心的 1–2 度鄰居。 */
  getLocalGraph(caller, documentId, input?: { depth?: 1 | 2 }): Promise<LocalGraphView>;
}
```

### 8.1 授權

- `getDocumentLinks`／`getLocalGraph`：沿用 `requireVisibleDocument`（文件 → Source → Workspace → membership；封存可見性與 `getDocument` 相同）。該私有方法抽成 `application/internal/require-visible-document.ts` 供兩邊共用，行為不變。
- `getWorkspaceGraph`：`requireMembership(caller, workspaceId)`。
- 目錄與邊都以**同一個 `workspaceId` 過濾**（SQL join `knowledge_sources`）。因為解析只在這個集合內進行，輸出的每個節點與邊都屬於呼叫者已被授權的 Workspace；不存在「先取全部再過濾」的步驟。
- Workspace 是唯一的授權邊界（Phase 3 §13：沒有 Source／Document ACL），所以 membership 足夠；不需要新的 capability。封存的 Workspace 沿用現有讀取語意（可讀）。

### 8.2 `getDocumentLinks`

`revisionNo` 可選：閱讀頁在看歷史版本（`?revision=N`）時傳入，outgoing 要對應那份內容；未傳則用目前 revision。service 自己依 `revisionNo` 讀取該 revision（經同一個授權檢查），**不接受呼叫者傳入的 Markdown 本文**。outgoing 由 `extractDocumentLinks` 現算後對目錄解析——**不需要索引**；只有 `backlinks` 需要別的文件的邊。

回傳：

- `outgoing`：每條唯一連結（依 `kind + 正規化 target` 去重）與其解析結果；
- `backlinks`：`{ documentId, sourceId, sourceName, title, count, context }[]`，以 title、documentId 排序；`context` 取連結所在行，去掉 `[[`／`]]`／Markdown 連結語法，最長 160 字元。上下文只對前 50 個來源文件載入 markdown；
- `unresolved`：outgoing 中未解析者；
- `index`：`{ documents, stale }`。

### 8.3 `getWorkspaceGraph`

```ts
type GraphNode = { id: string; kind: "DOCUMENT" | "UNRESOLVED"; title: string; sourceId: string | null; inDegree: number; outDegree: number };
type GraphEdge = { from: string; to: string; count: number };
type WorkspaceGraphView = {
  nodes: GraphNode[]; edges: GraphEdge[];
  total: { documents: number; edges: number };          // 過濾前
  truncated: { shown: number; total: number } | null;   // 超過上限時
  index: { documents: number; stale: number };
};
```

`UNRESOLVED` 節點只在 `includeUnresolved` 時出現，以正規化 key 分組（多份文件指向同一個不存在的標題是同一個節點），id 為 `unresolved:<key>`。

## 9. TOC 與標題錨點

### 9.1 Slug

`headingSlug(text)`：`NFC` → 小寫 → 移除不屬於 `\p{L}\p{M}\p{N}\p{Pc}`、`-`、空白的字元 → **每個**空白換成一個 `-`。**不合併連續的 `-`、不去頭尾的 `-`**：`a - b` 是 `a---b`，與 GitHub 一致，這正是「不改內容就能用」的條件。結果為空則用 `section`（空 id 無法連結）。同一份文件內重複時依序加後綴 `-1`、`-2`，且加了後綴的 slug 也算已被占用（GitHub 規則）。中文標題因此可用（`## 請假流程` → `#請假流程`）。

### 9.2 單一來源

`src/shared/markdown/` 有**一份**解析設定（`unified` + `remark-parse` + `remark-gfm`）、**一個** slug 指派函式 `assignHeadingSlugs(tree)`。渲染時 `remarkHeadingIds` plugin 與目錄抽取 `extractOutline(markdown)` 都呼叫它，所以錨點與目錄項目不可能各算各的。測試把兩者的結果逐一比對（含 CJK、重複標題、含 GFM 刪除線的標題）。

### 9.3 UI

- 項目：深度 1–4 的標題，縮排依相對於文件最小深度；標題少於 2 個不顯示；最多 200 項。
- 元件 `DocumentOutline`：`<nav aria-label="On this page">` 內的 `<ol>`，目前段落 `aria-current="location"`。捲動同步用 `IntersectionObserver`（root 是文件內容捲動容器，不是 window）。點擊 → `scrollIntoView`（reduced motion 時不平滑）+ `history.replaceState` 更新 hash。
- 位置：內容右側 sticky rail（`min-[1280px]`、inspector 關閉時）；inspector 內另有「Outline」分頁（inspector 開著時 rail 讓位）；窄螢幕是內容頂端的 `<details>`。
- 標題加 `scroll-mt-4`，並沿用 `contain-layout` 捲動容器，hash 導覽不被頂端遮住。

## 10. 圖譜

### 10.1 建構

`buildWorkspaceGraph(catalog, edges, options)` 與 `buildLocalGraph(graph, focusId, depth)` 是純函式。Local graph 以無向邊做 BFS，深度 1 或 2，最多 60 個節點（距離近者優先、其次 degree）。

### 10.2 Layout

`layoutGraph(nodes, edges)` 用 `d3-force`（`forceLink`、`forceManyBody`、`forceCenter`、`forceCollide`）同步跑固定 tick 數後 `stop()`，不做動畫。tick 數**依節點數固定**（≤200 個節點 300、≤500 個 200、其餘 150），不是時間預算——時間預算會讓畫面取決於機器當時忙不忙。`simulation.randomSource` 用固定種子的 LCG，節點與邊都先依 id 排成正規順序（邊的順序會影響 `forceLink` 的累加順序，實作時的決定性測試抓到過這件事），所以**同樣的圖，不論輸入順序，永遠得到同樣的座標**——SSR 與 hydration 一致、E2E 可預測、單元測試可斷言。1000 節點、3000 邊的合成圖量測約 1.0 秒（§14）。

### 10.3 繪製

`GraphCanvas`（client component）以 `<svg>` 繪製：邊用 `stroke-kh-border-strong`，節點用 `fill-kh-primary`／`fill-kh-text-muted`，目前文件用 `fill-kh-primary`，`UNRESOLVED` 節點虛線外框且 `fill-kh-bg`；**不引入任何 token 以外的顏色**（設計語言 §8：顏色只在 CSS 變數層，亮暗自動）。節點半徑隨 degree 從 4 到 12。標籤：節點 ≤ 80 個時全顯示，否則只顯示 hover／focus／目前文件與其鄰居。

### 10.4 互動

平移（拖曳背景）、縮放（滾輪、`+`／`−`／Reset 按鈕，鍵盤可用）、hover 高亮鄰居並淡化其他、點擊開啟文件（普通點擊走 client navigation，修飾鍵維持瀏覽器預設）、標題搜尋框高亮。過濾條件（Source、orphans、unresolved、focus）放在 URL search params，由伺服端重算，所以可分享、可書籤、上一頁有效。`prefers-reduced-motion` 時關閉縮放與 hover 的過渡。

### 10.5 無障礙

`<svg role="group" aria-label="Knowledge graph, N documents, M links">`；每個節點是 SVG `<a>`（原生可聚焦，Tab 順序依 degree 由高到低，`aria-label` 含標題與連結數）；另提供 **List view**——同一份資料的表格（標題、Source、進入連結數、外出連結數），是給螢幕閱讀器與鍵盤使用者的完整替代，不是次要功能。

### 10.6 空狀態

沒有任何連結時不畫一張只有孤點的圖，而是說明「用 `[[標題]]` 連結文件，這裡就會出現關係」。索引未完成時顯示 §7.4 的提示。

## 11. UI 與設計語言

- 元件放 `src/components/knowledge/`（`document-outline.tsx`、`document-links-panel.tsx`、`backlinks-footer.tsx`、`graph-canvas.tsx`、`graph-controls.tsx`），頁面 `src/app/w/[workspaceId]/graph/page.tsx`；沿用 `/w/:workspaceId/...` 路由，不建 `/me`（Phase 3 §3.2）。
- 只用 tokens 名稱：`text-body`／`text-body-sm`／`text-caption`、`rounded-md`、`shadow-popover`、`duration-120`、間距階梯（設計語言 §3–§5、§18 第 2 項）；不新增 token，所以不需要修改 `tailwind.config.ts` 與契約文件。
- 動作註冊表（動作模型規格 §4）新增：`navigate.graph`（palette，「Open graph」）與 `document.backlinks`（**只在 palette**，「Show backlinks」，開啟 inspector 的 Links 分頁）。`document.backlinks` 不出現在 row menu，理由與 `document.details` 相同：它開啟的面板描述的是目前正在閱讀的那份文件，在別的列上提供會承諾一個顯示不了那一列的畫面。兩者都是讀取，不依賴 capability、所有權或生命週期（歷史 revision 上也提供）；可用性規則寫在註冊表、有單元測試。`navigate.graph` 因此使「沒有任何 capability 的成員」可用的動作從 1 個變成 2 個（Knowledge 與 Graph）——能讀 Knowledge 就能看它的圖。
- 主導覽新增「Graph」項（`Network` 圖示），所有有讀取權的人可見。
- 載入：圖譜頁用既有的 skeleton 慣用法與 `loading.tsx`。
- **指向自己所在頁面的連結一律 `prefetch={false}`**（depth 切換、Graph／List 切換、內文的 wikilink——渲染器不知道目前是哪份文件，自連結 `[[本文標題]]` 同樣會踩到）。從自己這頁 prefetch 自己，伺服器回整頁，Next 15 會直接套用 prefetch 的首次使用，與點擊競爭時導覽會遺失（keyboard-shortcuts spec §9；實作時在 local graph 的 depth 切換上重現：修正前約每 8 次失敗 1 次，修正後 30／30 通過）。

## 12. 安全與不變式檢查

| 不變式（CLAUDE.md） | 本規格如何維持 |
| --- | --- |
| Scope is derived, never stored twice | 索引表不含 `workspace_id`／`source_id`；一律經 Document → Source → Workspace |
| Knowing an ID is not authorization | 所有讀取都是 `CallerContext` + membership；`focus=<documentId>`、`workspaceId` 只是導覽輸入，service 重新驗證 |
| `org_code` does not decide access | 完全不涉及 |
| Source ownership decides who may write | 索引是**讀模型**：`SOURCE_MANAGED` 文件的連結一樣被索引與顯示，但沒有任何寫入內容的操作；Backlinks 來自唯讀文件時只是顯示 |
| Identity vs position vs content | 索引只依賴 revision 內容；移動、改名不產生索引寫入；解析時才看標題與路徑 |
| Lifecycle is ACTIVE / ARCHIVED only | 封存文件不是目標也不是來源（讀取時過濾）；不 hard delete；替換子列是 derived data 的維護，不是刪除 Knowledge |
| 分享連結是唯一的 bearer grant | 新的讀取路徑都需要 `CallerContext`；分享頁不呼叫連結服務、不解析 `[[…]]`（D9）。`share-link-single-exception` 三項測試維持通過，並新增一項：分享頁的元件樹不 import 連結服務 |
| 授權不由索引決定 | 索引整表清空不改變任何人能讀什麼；它只影響「顯示哪些關係」 |

**不洩漏**：`UNRESOLVED` 不區分「不存在」與「在別的 Workspace」（D6）；Backlinks 只含同一 Workspace、ACTIVE 且呼叫者能讀到的文件——Workspace 是單一授權邊界，所以「能讀 Workspace」等於「能讀其中任何文件的標題與內容」，不存在部分可見的來源文件。

## 13. 分階段交付與驗收

四個切片，每個獨立可合併、可回退；後一個依賴前一個的程式碼但不依賴其資料。

| 切片 | 內容 | 資料變更 | 驗收（節錄，完整清單在實作計畫） |
| --- | --- | --- | --- |
| **1. TOC** | 共用解析、slug、`remarkHeadingIds`、`extractOutline`、`DocumentOutline`（rail／inspector 分頁／窄螢幕） | 無 | 標題有 `id` 且與目錄逐項一致（含 CJK、重複、GFM）；`[x](#slug)` 站內錨點生效；捲動同步；<2 個標題不顯示；歷史 revision 顯示該版的目錄 |
| **2. 連結模型與索引** | `document-links.ts`（抽取＋解析）、migration 012、`DocumentLinkRepository`、四個寫入點、`reindex` 腳本、`KnowledgeLinkService.getDocumentLinks` | migration 012；需 reindex | 抽取語法表全部有測；四個寫入點都寫索引且 NOOP 不重建；新 revision 替換而非累加；跨 Workspace 不解析；非成員被拒；reindex 冪等且能修復被清空的索引 |
| **3. 連結渲染與 Backlinks** | 渲染 `[[…]]` 與相對 `.md` 連結（resolved／unresolved）、inspector「Links」分頁、文件底部「Linked from」、`document.backlinks` 動作、分享頁純文字 | 無 | 有效連結導覽正確；失效連結有虛線與 tooltip；Backlinks 含上下文；同名多份時連到規則選出的那份；分享頁不出現 `/w/` 連結 |
| **4. 圖譜** | `buildWorkspaceGraph`／`buildLocalGraph`／`layoutGraph`、`getWorkspaceGraph`／`getLocalGraph`、`/w/:id/graph`、inspector Local graph、主導覽與 palette 入口、List view | 無 | layout 可重現；上限與 truncated 提示；orphans／unresolved／Source 過濾；點節點導覽；鍵盤可達；List view 與圖同資料；空狀態與索引更新中提示 |

**整體驗收場景**（My Space，E2E）：

1. 在 My Space 建立 A、B、C 三份文件，A 寫 `[[B]]` 與 `[[不存在的文件]]`，B 寫 `[[A]]`。
2. 開啟 B：Backlinks 列出 A（含那一行）；開啟 A：`[[B]]` 是連結，`[[不存在的文件]]` 是失效連結。
3. 開啟 Graph：三個節點、A↔B 一條邊、C 是孤立節點；勾選 unresolved 出現虛線節點；點 A 節點進入 A。
4. 一份含四個標題的長文件：目錄四項，點第三項捲動並更新 hash。
5. 匯入一個含 `[x](../notes/b.md)` 的資料夾：連結指向匯入後的那份文件，Backlinks 與圖譜有對應邊。

## 14. 效能與規模

| 項目 | 設計 | 上限與量測 |
| --- | --- | --- |
| 寫入：抽取 | 每份文件 1 次抽取；不含 `[[` 或 `.md` 的文件**跳過解析** | 成本主要是 Markdown 解析（約 1.7 ms／KB）：3.7 KB、40 條連結的文件約 4–8 ms；沒有連結的文件約 0.003 ms |
| 寫入：SQL | 3 個語句（刪子列、upsert 標記、批次插入，每 500 列一批） | import Apply 增加的是常數個語句／文件；`phase2-import-apply-perf` 斷言每份文件恰一次替換 |
| 文件頁讀取 | 載入目錄（id、title、path）與該 Workspace 的有效邊，記憶體內解析 | 2 000 份文件、20 000 條邊：中位數 96 ms、p95 119 ms；含 2 度 local graph 中位數 131 ms |
| 圖譜 | 同上再加 layout | 節點上限 1000。資料讀取＋建構 133 ms；layout 約 1.0 s（1000 節點、3000 邊的合成圖；真實連結圖較稀疏）。典型 My Space（數百節點）遠低於此 |
| 邊數護欄 | 每份文件 2000 條 | 超過的部分不索引 |

量測環境是開發用容器，資料庫與測試同機；數字用來確認量級與回歸，不是容量承諾。原始數字與方法見 verification 紀錄。

**已知取捨**：文件頁每次讀取的成本是 O(Workspace 大小)，而不是 O(這份文件的連結數)。對 My Space 的規模（數百到數千份）這不是問題；若之後 Workspace 大到成為問題，最佳化路徑是在邊表加一個正規化 key 欄位與索引，讓 Backlinks 只查候選邊（§16）。這是資料結構的擴充而非重寫，因為邊本來就存 raw target。

## 15. 待拍板與風險

| # | 事項 | 建議預設（已採用） | 若改變 |
| --- | --- | --- | --- |
| Q1 | 功能只給 My Space，還是所有 Workspace | 所有 Workspace（D1） | 兩個入口（導覽項、文件頁 service 呼叫）加 `workspaceType === "PERSONAL"` 條件 |
| Q2 | 新增依賴 `d3-force`（server-only）、`unified`、`remark-parse`（後兩者已是 `react-markdown` 的相依，改為明確宣告） | 接受 | 手寫力導向模擬（約 80 行）；解析改用 `mdast-util-from-markdown` + 明確加入 gfm 擴充 |
| Q3 | 未索引時顯示「更新中」而非讀取時自動修復 | 顯示提示（保持讀取路徑唯讀） | 讀取時對少量過期文件就地修復，代價是讀取路徑出現寫入與鎖競爭 |
| Q4 | Graph 預設顯示孤立節點 | 顯示（超過上限時孤立節點最先被捨去） | 改預設隱藏，只是 URL 參數預設值不同 |
| Q5 | `.md` 相對連結是否要求同 Source | 是（相對路徑只有在 Source 內才有意義） | 允許跨 Source 需要定義 Source 之間的路徑空間，不建議 |

風險：

- **語法邊界**：`[[a\|b]]` 在 GFM 表格內需寫成 `\|`；被強調語法切成多個 text 節點的 wikilink（如 `[[*x*]]`）不會被辨識。兩者都記在測試裡作為已知行為。
- **標題 id 與應用程式 id 衝突**：作者的標題 `Main` 產生 `id="main"`。實作時掃描現有 `id=` 用法確認無衝突；若有，改由那一邊重新命名。
- **索引與內容漂移**：任何未來新增的「產生 revision」的路徑若沒掛上索引，該文件會被標為 stale 而不是靜默錯誤——這是把有效性寫成 `revision_id` 比對（§7.2）的主要理由。新增產生 revision 的路徑時，PR 檢查表要包含「是否呼叫 `links.replaceForDocument`」，並有一個 integration test 掃描 `revisions.insert` 的呼叫點與 `links.replaceForDocument` 成對出現。

## 16. 後續待辦（不在本次交付，依價值排序）

| 項目 | 需要什麼 | 備註 |
| --- | --- | --- |
| 從失效連結建立文件 | `/knowledge/new` 接受 `?title=`；只在有 HUB_MANAGED Source 且有 write capability 時提供 | 最小成本、最貼近 Obsidian 的工作流 |
| 編輯時 `[[` 自動完成 | 編輯器偵測 `[[`、呼叫既有 quick-search API、插入 `Title]]` | 與 §18 第 3 項的編輯器重做一起評估，避免做兩次 |
| Tags | 抽取 `metadata.tags` 與行內 `#tag`；索引表 + Tag 頁 + 圖譜著色 | 需要一份小規格 |
| Favorites／Recents | per-user 表；動作註冊表 `favorite` 欄位改讀資料 | 註冊表已預留 |
| Unlinked mentions | 借 Phase 4 search 查標題出現處，排除已連結者 | 純讀取 |
| Backlinks 查詢最佳化 | 邊表加 `target_key` 與索引 | §14 的擴充路徑 |
| 改名時改寫連結 | 只對 `HUB_MANAGED`；每個受影響文件一個 revision，需要確認流程 | D10 的替代方案；影響歷史，需另立規格 |
| Hover 預覽、Daily notes、Properties 面板 | — | P2 |

# 文件連結索引 — 上線程序

[English](document-link-index-rollout.md) | **繁體中文**

適用於 migration `012-document-link-index` 及讀取此索引的功能（backlinks、link graph）。設計文件：[`personal-workspace-knowledge-graph-design`](../superpowers/specs/2026-09-29-personal-workspace-knowledge-graph-design.md) §7。

## 變更內容

Migration 012 新增 `knowledge_link_index` 與 `knowledge_document_links` 兩張表。它們是**衍生資料**，可隨時從 revisions 重建，不用來決定存取權。清空它們只改變顯示的關係，不改變可存取的文件。

新 revisions 會自行建立索引：四個 writers（Hub create／revise、folder-sync project document／revision）都在寫入 revision 的同一交易中取代文件 edges。**Migration 前已存在的文件沒有 index row**；migration 不能寫入資料，因此必須執行一次修復腳本。

## 順序

```text
1. npm run db:migrate                      # 新增空表；若有未建立索引的文件會顯示提示
2. npm run db:reindex-document-links       # 或 make db-reindex-links
3. 部署／啟用讀取索引的版本
```

步驟 1、2 可在部署新版前執行。舊版不讀寫這些表，因此在此期間由舊版儲存的文件，會在下一次修復時被判為 stale。

## 修復腳本

`npm run db:reindex-document-links [-- --target dev|test|e2e] [-- --batch-size N]`

- **冪等、可恢復。** 只索引缺少 index row、來自舊 revision 或舊規則版本（`LINK_EXTRACTOR_VERSION`）的文件。重跑會顯示 `0 document(s) indexed`。
- **可與流量並行。** 每份文件使用獨立交易：鎖住文件，在鎖內讀取 current revision 並取代 edges。執行中到達的 save 會等鎖後自行索引；腳本不會用舊 revision 的 links 覆寫新版。
- **包含全部文件與封存文件**，所以還原不需額外 index write。
- 每篇成本為一次 Markdown parse 與三個 statements；數千篇筆記約需數秒至一分鐘。

## 尚未執行時的使用者體驗

Backlinks 與 graph 只讀**有效** index rows。腳本執行前，缺少索引的文件計為 stale，UI 顯示 "Link index is updating (N documents)"，避免將空清單誤認為事實。Outgoing links 與目錄不依賴索引，可立即使用。

## 抽取規則變更

同一變更需增加 `src/modules/knowledge/domain/document-links.ts` 的 `LINK_EXTRACTOR_VERSION`。所有既有 rows 會讀為 stale，再由同一腳本更新。

## 新增寫入 revision 的路徑

必須在同一交易呼叫 `repositories.links.replaceForDocument(...)`。`tests/unit/link-index-write-points.test.ts` 會在 source file 插入 revisions 卻未同步索引時失敗。遺漏不會默默顯示錯誤關係，文件會顯示 stale，但仍是缺陷。

## 回滾

不需刪表。舊版忽略這些表，後續新版仍可安全重跑修復腳本。若必須移除，所有資料皆可重建：依序執行 `DROP TABLE knowledge_document_links; DROP TABLE knowledge_link_index;`，並從 `schema_migrations` 移除 version 12。

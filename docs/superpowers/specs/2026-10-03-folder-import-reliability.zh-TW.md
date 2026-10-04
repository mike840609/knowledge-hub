# Folder import 可靠性強化

[English](2026-10-03-folder-import-reliability.md) | **繁體中文**

本次後續工作從 PR #98 已驗證的 `c3cc2156e1f5a347709d02920d1709fe6aff4fe8` 開始，保留其 authorization 與 Strict Mode 修正。

## Session 行為

- Upload batch 或 finalize 遇到短暫網路失敗、HTTP 408／425／429／500／502／503／504 時，最多重試一次，使用相同 snapshot 與完全相同 batch。每次嘗試前重新檢查取消與權限。
- 成功 finalize 的 body 無法讀取時，視為 lost response 並重試 finalize。Server 的 upload 與 finalize 已具 idempotency。
- Session creation 不是 idempotent，不重試也不中斷。即使建立途中已取消，仍須取得回傳 id 才能清理。
- 明確 Cancel import、component unmount、pagehide 都停止後續工作。終止失敗／取消時，對已知 snapshot 發送 best-effort keepalive DELETE。Offline／unknown-id 失敗保留原有兩小時 BUILDING TTL fallback。
- DELETE 從可信任 identity 推導 caller，以原子操作只刪除該 creator 的 BUILDING staging。Cascading entries 立即釋放 quota。重複刪除、其他 creator、READY／APPLIED／STALE 狀態回傳 `abandoned: false`。Workspace 權限撤銷後仍允許清理私有 staging；canonical knowledge 不變。

## 資源限制

- 預設拒絕單一超過 64 MiB 或合計超過 512 MiB 的 assets。`KM_IMPORT_MAX_ASSET_FILE_BYTES` 與 `KM_IMPORT_MAX_ASSET_TOTAL_BYTES` 可用正整數 bytes 覆寫上限。
- 首次 import 與 resync pages 將 server limits 傳給 client。Client preflight 在讀取任何 bytes 前檢查所有大小。Server 在保存 staging 前獨立驗證 manifest，依副檔名分類。
- 最多同時 hash 四個 assets，保留排序後 manifest 順序與 hashes，在讀取與 hashing 之間檢查取消。失敗後停止安排工作；已啟動且無法中斷的 reads／digests 完成後才返回。
- Binary assets 仍是 reference metadata；Markdown 與既有 upload limits 保持原行為。

## 驗證

行為單元測試涵蓋 retry、cancellation、worker bounds、preflight、runtime configuration；MariaDB integration tests 涵蓋 ownership、cascades、quota、terminal-state protection；browser tests 涵蓋 server commit 後 lost response、明確取消與 API limits。執行完整 unit、integration、E2E，加上 typecheck、lint、production build。新 PR 疊在 #98 上，diff 只含此後續工作；兩個 PR 都不 merge。

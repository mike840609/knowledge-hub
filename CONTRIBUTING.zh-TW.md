# Contributing to Knowledge Hub

[English](CONTRIBUTING.md) | **繁體中文**

歡迎提交 bug report、文件修正、測試與功能改善。參與討論時請尊重彼此，聚焦可重現的行為與具體建議。

## 回報問題與建議

請在 [GitHub Issues](https://github.com/mike840609/knowledge-hub/issues) 說明：

- 問題或使用情境，以及預期與實際行為。
- 重現步驟、Node.js／瀏覽器版本、作業系統及個人或 Team 模式。
- 必要的錯誤訊息與截圖；移除密碼、token、個人資訊及非公開內容。

安全性漏洞請依 [SECURITY.md](SECURITY.md) 私下回報。較大的功能或資料模型變更，建議先開 issue 討論需求與相容性。

## 本機開發

依 [README](README.zh-TW.md#快速開始) 完成環境設定，從自己的 fork 建立功能分支。維持既有模組分層；HTTP 與 UI 應透過 application services 存取 domain，並遵守 Workspace policy 與 Source ownership 規則。

## Pull Request

1. 保持變更聚焦，更新受影響的文件；行為變更補上有意義的測試。
2. 執行 `make verify`。涉及資料庫、授權、匯入或 migration 時執行 `make test-integration`；涉及使用者流程時執行對應 E2E。
3. 描述問題、變更後行為、測試結果與部署／migration 注意事項。未能完成的檢查請清楚註明。
4. 不提交 `.env`、憑證、資料庫 dumps、個人資料或測試產物。

資料庫升級需考慮既有資料與 readiness gates；公開 API 或資料匯出格式的變更需交代相容性。

提交貢獻即表示你有權提供該內容，並同意以本專案的 [MIT License](LICENSE) 授權。第三方程式碼或素材請保留必要的來源與授權聲明。

## 文件語言

專案文件以英文為主。每份 Markdown 指南都有同目錄的 `*.zh-TW.md` 中文版本，並在標題下方提供雙向語言連結。修改文件中的行為說明時，請同步更新兩版。翻譯時保留指令、識別字、測試輸入與歷史驗證結果。`tests/fixtures/` 內的 Markdown 是測試資料，不適用此慣例。

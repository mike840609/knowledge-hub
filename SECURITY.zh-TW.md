# Security

[English](SECURITY.md) | **繁體中文**

Knowledge Hub 目前持續開發，尚未承諾獨立的長期維護版本。安全性修正以 repository 的最新開發版本為優先；部署者應追蹤更新並檢查依賴的安全公告。

## 私下回報漏洞

請勿在公開 issue 貼出可利用的漏洞細節、憑證或私人知識內容。請使用 [GitHub 私下漏洞回報](https://github.com/mike840609/knowledge-hub/security/advisories/new)；此入口需 repository 管理者啟用 private vulnerability reporting。若入口不可用，可先開不含漏洞細節的 issue，請維護者提供私下聯絡方式。

回報請包含受影響版本／commit、重現步驟、預期與實際行為、影響範圍，以及可使用合成資料驗證的案例。專案尚未承諾固定回覆或修復期限。

## 部署注意事項

- Local identity、範例資料庫憑證與 production Local identity override 僅供開發或測試。
- 正式部署需使用可信任的 SSO session reader、HTTPS、獨立資料庫憑證與備份機制。
- Workspace membership／capability 必須由伺服器驗證；使用者組織屬性或知道文件 ID 不直接授予權限。
- 匿名唯讀分享連結允許持有者閱讀該文件的已存版本；請將連結視為分享憑證，必要時撤銷。
- 日誌、截圖與回報中的 token、身分資料及私人 Markdown 內容應先移除。

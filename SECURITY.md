# Security

**English** | [繁體中文](SECURITY.zh-TW.md)

Knowledge Hub is under active development and does not currently promise a separate long-term support release. Security fixes prioritize the latest development version. Deployers should track updates and review security advisories for dependencies.

## Reporting vulnerabilities privately

Do not post exploitable vulnerability details, credentials, or private knowledge content in public issues. Use [GitHub private vulnerability reporting](https://github.com/mike840609/knowledge-hub/security/advisories/new), which requires repository administrators to enable private vulnerability reporting. If that entry point is unavailable, open an issue without vulnerability details and ask maintainers for a private contact method.

Include the affected version or commit, reproduction steps, expected and actual behavior, impact, and a case that can be verified using synthetic data. The project does not currently guarantee a response or remediation deadline.

## Deployment considerations

- Local identity, example database credentials, and the production Local identity override are for development or testing only.
- Production deployments require a trusted SSO session reader, HTTPS, separate database credentials, and backups.
- The server must verify Workspace membership and capabilities. Organizational attributes and possession of a document ID do not directly grant access.
- Anonymous read-only share links let their holders read a document's saved version. Treat the link as a sharing credential and revoke it when needed.
- Remove tokens, identity information, and private Markdown content from logs, screenshots, and reports before sharing them.

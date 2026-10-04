# Open PR integration into #108

[English](2026-10-04-open-pr-integration.md) | **繁體中文**

本文件記錄開啟中的 PR 整合結果、衝突處理與驗證證據。 以下保留原始英文歷史證據全文，以維持測試輸出、數字、命令與路徑的可追溯性；本頁並非逐段中文翻譯。

The approved recommendation uses #108 as the primary Folder Sync implementation and selectively incorporates the independent UX work from #105, #106 and #107. These branches are based on main, not stacked dependencies; their complete commits should not subsequently be merged unchanged.

## Integration mapping

| PR | Retained work | Overlap resolution |
| --- | --- | --- |
| #105 (`726e75c`) | Explain local edit → check → Preview → Apply; keep sync status and last successful sync visible on mobile; pass runtime asset limits to homepage sync actions | Keep #108 reading-oriented homepage, folder cards, Updates and existing source sync actions |
| #106 (`7a4f5a7`) | Initially render 100 diff lines; reveal another 100 on demand | Keep #108 creator-private lazy diff endpoint, authoritative preview plan, metadata/title diff and server-side line/byte limits |
| #107 (`8bc9d89`) | Per-source browser-local file/folder exclusion rules, shared import pipeline filtering, fail-safe empty/corrupt exclusions, archive warning, manual Markdown feedback download | Replace separate workspace link-check parser/report with personal Source health overview linking existing per-source reports. Legacy `/link-check` redirects to `/sources/health` |

Personal homepage onboarding, health overview entry and feedback panel are Personal-only. Mobile source status, diff pagination and exclusions use shared source/import components in both workspace types. Existing workspace authorization and high-risk Apply confirmation still apply.

Custom exclusions use root-relative file or directory prefixes, not glob expressions, and are stored on the current browser per workspace/source. They must be saved before checking for changes. Excluding previously synced files can archive documents only after Preview and Apply. Reports are downloaded locally and are not submitted automatically.

## Validation

- Full unit suite: 1,632 passed across 123 files.
- Full integration suite: 640 passed across 61 files.
- Team-enabled source-import browser regression: 10 passed.
- Typecheck, lint and `git diff --check` passed.
- Production build and Personal-only browser tests: 3 passed, including 390px visible sync time, health navigation, saved exclusions and the preview-to-reading workflow.
- Incremental diff test first failed at 205 rendered lines instead of 100, then passed with 100 → 200 → 205 and only one fetch.
- Independent review of this integration found no actionable correctness/security issues.

Existing before/after images document the original first-wave implementation; this follow-up adds the mapped UX details. See the 2026-10-03 verification report and committed screenshot recorder for those comparisons.

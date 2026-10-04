# Personal workspace verification — 2026-09-30

[English](2026-09-30-personal-workspace.md) | **繁體中文**

本文件記錄個人工作區的行為與驗證結果。 以下保留原始英文歷史證據全文，以維持測試輸出、數字、命令與路徑的可追溯性；本頁並非逐段中文翻譯。

Implementation: `/Users/chuntsai/.codex/worktrees/personal-workspace/HCM-KM`, branch `codex/personal-workspace`, rebased onto `origin/main` at `00df011` (the remote has no `master` branch). All six authorized batches are implemented. No merge, deployment, or migration of the user's development database was performed. Existing primary-checkout edits were preserved. The remote mainline had already supplied the Team Coming soon selector and full tree-based organization, so the separate Organize page and API were removed.

## Successful checks

| Check | Evidence |
| --- | --- |
| `npm run test:unit` | 90 files, 1,291 tests passed after rebase |
| `npm run test:integration` | 50 files, 585 tests passed after rebase, including mainline organization and document-link tests |
| Team-enabled browser regression | 86 of 87 tests passed on the first run; the archived-sibling keyboard reorder test passed on an isolated rerun. Covers editor, routing, governance, revision history, row actions, share links, Team availability and tree organization |
| Personal-only browser flows | 2 tests passed after rebase; Team disabled, cross-browser drafts, Home-to-Knowledge organization link, Markdown/ZIP export, revision restore, account favorites and new-note recovery after closing its tab |
| Production build | Passed via E2E harness, including TypeScript and Next.js lint checks |
| `npm run lint` and `git diff --check` | Passed after rebase |
| Visual inspection | Inspected the Home screenshot at 1280×720; the old duplicate Organize page was removed in favor of the mainline Knowledge tree |

Browser commands:

```bash
KM_TEAM_WORKSPACES_ENABLED=true KM_E2E_PORT=3217 npm run test:e2e -- team-workspaces-coming-soon.spec.ts zz-organize.spec.ts zz-organize-move.spec.ts document-composer.spec.ts revision-history.spec.ts phase2.5-routing.spec.ts phase3-workspace-governance.spec.ts share-link.spec.ts row-actions.spec.ts
KM_TEAM_WORKSPACES_ENABLED=false KM_E2E_PERSONAL_ONLY=true KM_E2E_PORT=3217 npm run test:e2e -- personal-workspace.spec.ts
KM_TEAM_WORKSPACES_ENABLED=true KM_E2E_PORT=3217 npm run test:e2e -- zz-organize-move.spec.ts -g 'step over a sibling that is archived and out of sight'
```

Tests used automatically provisioned and disposed MariaDB databases. ZIP output was checked with `unzip -t` in the browser test. Team re-enablement was tested against existing Team data and memberships. A regression test reproduced empty personal-item keys being accepted; the final integration run verifies that they now fail validation. Draft conflict tests verify that discarding a local recovery copy cannot delete a newer remote draft.

The Team browser run's one failure was a 15-second wait for the second keyboard reorder step; its isolated rerun passed in 1.5 seconds. The tree reorder implementation is unchanged from `origin/main`. This run does not establish whether the timeout was a one-off scheduling delay or an existing intermittent issue.

## Adoption and boundaries

- Bring the isolated changes into the desired checkout while preserving its existing editor changes, install locked dependencies, then run `npm run db:migrate` to apply migration 013 (`personal_items`). Migration 012 belongs to the document link index. Restart the application.
- Team is disabled unless `KM_TEAM_WORKSPACES_ENABLED=true`. Disabled entries remain visible with Coming soon text. This is also enforced by server authorization; existing Team records are retained.
- Drafts and favorites are account-backed. Recent reading remains local to the device. There is one new-note draft slot per personal workspace, plus one draft per existing document. Failed draft uploads retain a local recovery copy when browser storage is available.
- Organization supports Hub-managed content and uses existing lifecycle/ownership rules. Nonempty folders must have their active children moved or archived first. There is no hard delete or cross-source move.
- ZIP exports contain current saved revisions, including archived notes, metadata and an ID/path manifest. Original Markdown links remain unchanged. Drafts, revision history and attachment binaries are excluded. Limits are 64 MiB and 9,999 documents.
- The selected browser suite covers affected flows; this was not a run of every repository E2E suite. Load testing with large personal libraries and device/responsive matrix testing were not performed.

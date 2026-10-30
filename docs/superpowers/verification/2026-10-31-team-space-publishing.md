# Team space publishing — verification

Date: 2026-10-31 (Asia/Taipei).
Branch: `docs/team-space-publishing`.
HEAD during the recorded gates: `f256bf7d` plus this task's working tree (new e2e spec, fixtures, documentation and the smoke-catalog update). The work is committed as `test: verify team publishing workflow and rollout`.
Spec: `docs/superpowers/specs/2026-10-30-team-space-publishing-design.md`. Plan: `docs/superpowers/plans/2026-10-31-team-space-publishing.md`.

## Scope

- End-to-end workflow with the fixed Phase 3 HTTP personas, against a production build and an isolated MariaDB database: sync, publish, read, comment, Inbox, creator update, join without overwrite, archived-path reattach, membership removal, unpublish.
- The two writer guards, the anonymous share-link guard and the personal review/follow/mention regressions, included in the recorded unit and integration runs.
- Rollout documentation for enable → catch-up → pending save/sync and for unpublish/restore conflicts.

Environment: macOS, Node v24.6.0, Playwright 1.63.0 with the installed Chromium, MariaDB in Docker on port 3307 (the project's isolated test-database harness provisions and disposes its own schema), workers=1. `make browsers` was already satisfied.

## Commands and outcomes

| Command | Result |
| --- | --- |
| `npm run test:e2e -- tests/e2e/zz-team-publishing.spec.ts` | **PASS** — 7 tests, 25.8s in the browser stage; 102.42s including build; zero failed, flaky or skipped. |
| `make verify` | **PASS** — unit **339 files / 4,077 tests passed**; `tsc --noEmit` clean; ESLint clean; production build compiled. |
| `npm run test:integration` | **PASS** — **111 files / 1,131 tests passed**. |
| `npm run test:e2e:smoke` | **PASS** — **15 tests passed**, 0 failed/flaky/skipped; includes all seven new team flows. |
| `npm run test:e2e:smoke:personal` | **FAIL (pre-existing, not this feature)** — 3 passed, 1 failed: `personal-workspace.spec.ts` → after “Restore revision 1”, the editor shows the recovered draft (“Persistent draft body”) instead of the restored “Original body”. Reproduced identically at `main` `2aada14f` with the same command (3 passed, 1 failed), where none of this feature's code exists. No product or unrelated test was changed to hide it. |

`make verify` initially failed only `tests/unit/e2e-smoke-selection.test.ts`, whose catalog pins the approved Team smoke flows; the seven new approved flows are now declared there. Nothing product-side was corrected by that change.

All recorded gates ran on the final product behaviour and the final e2e assertions. The commits after the gate runs change only this record, the operations documentation and one e2e comment; no product or test behaviour differs from what was run.

## End-to-end cases

`tests/e2e/zz-team-publishing.spec.ts`, tagged `@smoke-team`, serial because they are one workflow. Mike is the fixed `owner` persona, Ann the fixed `editor` persona, and a second `admin` persona is granted OWNER so the last-owner rule cannot block the removal case. User ids are never accepted from the browser.

1. **Publish.** Mike applies a folder sync of a repo-shaped fixture (`team-hcm-v1`, documents under `hcm/`), publishes the `hcm` folder from My Space as 「HCM KM 設計」 through the real dialog, and the team list reports one ACTIVE FOLDER publication created by “Phase3 owner”; the team tree names both documents 「由 Phase3 owner 維護」.
2. **Read, discuss, Inbox.** Ann sees the publication, reads `hcm/guide.md`, and starts a discussion from the paragraph control. Mike's personal Inbox shows the comment under “HCM Guide”; the entry opens the team document with its thread (team href, not a share token), and the comment is visible there.
3. **Creator update.** Mike syncs `team-hcm-v2`. Polling `/api/documents/:id/peek?brief` as Ann shows “Revised in My Space.”, and her reload renders it. No team-side write was made.
4. **Join without overwrite.** Ann syncs her own copy (newer `guide.md`, a new `ann-notes.md`) and joins from her `hcm` folder. The join report creates exactly one document (her new path) and returns two `MAINTAINED_BY_OTHER` notices naming Mike; Mike's guide is unchanged. Her next sync preview shows 「由 Phase3 owner 維護，你的版本不會更新團隊」, the Apply response carries the same notice, the team guide still shows Mike's text, and Ann's own copy updates.
5. **Archived-path reattach.** Ann discusses `hcm/reference.md`. Mike removes the file (team copy ARCHIVED), then re-adds the same file. The fixture keeps `knowledge_id: team-hcm-reference`, so the import reconciler matches the archived entry by external identity and restores the same original and document; the team copy becomes ACTIVE again under the same document id with its discussion, and the team tree shows it under Mike. This is the “removed, then restored original” branch. The different-original branch — delete plus add producing a new original — is not reached by this browser case and is covered in `tests/integration/publication-reconcile.test.ts` (“re-attaches the same copy for a same-sync delete plus add”).
6. **Removal.** Admin removes Mike. His Inbox attention list no longer offers the entry; All activity keeps two opaque rows titled “A team discussion” with “This discussion is no longer available.”, no title, no comment text, no link and no Mark read action. Re-adding him as a member restores access, isolating the next case from lost membership.
7. **Unpublish is sticky.** Mike unpublishes through the publication menu and its confirmation. The publication is ARCHIVED, the active list is empty, and the team entry disappears. He then syncs `team-hcm-v5`; after a scheduling window the publication is still ARCHIVED, the active list is still empty, its source is still ARCHIVED, and the team tree still has no entry. (Unpublish archives the publication source; the copied document rows keep their own lifecycle, and visibility is derived from the source.)

## Guards and regressions in the recorded runs

- `tests/unit/publication-event-write-points.test.ts` — 11 tests passed: revision, move and lifecycle writers record a publication event in their own transaction; the team publication writer records none.
- `tests/unit/link-index-write-points.test.ts` — 2 tests passed: every revision writer still replaces link edges, including the publication projection.
- `tests/unit/share-link-single-exception.test.ts` — 11 tests passed: the anonymous share-link exceptions are unchanged; team review adds none.
- Personal review, follow and mention regressions in the integration run: `document-review-service` 25, `review-reply-follow` 16, `review-mentions` 45, `share-comment-notify` 12, `folder-share-mentions` 8 — all passed. The full integration suite (1,131 tests) also covers the publication service, reconciliation, lifecycle, lock order, drain, links, Inbox and API contracts.
- `tests/unit/e2e-smoke-selection.test.ts` — 4 tests passed after declaring the new `@smoke-team` flows.

## Flag and rollout

`KM_TEAM_WORKSPACES_ENABLED` remains default off; this task changes no default and adds no dependency. With the flag off, publication routes answer 404 and team spaces stay closed. The operational order is in `docs/operations/team-workspaces-availability.md` (and the zh-TW companion): deploy, enable and restart, run `make db-catch-up-publications`, then have each reported `pending` contributor save or sync once. That request reconciles a contributor who still holds `source.manage` and freezes one who was removed or demoted; the doc states the expected end state for each. Unpublish/restore/rename conflict behavior and stickiness are documented alongside it, as is the Folder Sync source-root publishing limit.

## Unresolved limits

1. **Personal smoke has one pre-existing failure** (details above). It reproduces on `main` and is unrelated to publication code; this task did not fix it, because doing so would change a different feature without its own design review. The Team smoke is green.
2. **A Folder Sync source's root is not a publishable tree folder.** The import places documents directly under the source, and the tree renders no root folder row, so the UI offers 「發佈到團隊」 only for a folder *inside* a synced source (the e2e publishes `hcm/`). Publishing the whole synced source would need a design decision — a source-as-folder origin, or a real root folder node for imported sources — not a Task 13 fix. The service already accepts any owned folder node.
3. **The e2e exercises direct members only.** Group-only rights are covered by unit/integration tests (pending catch-up, caller-based group judgement), not by a browser persona.
4. **Catch-up was run against isolated test databases, not production data.** The pending-save/sync operator flow is documented and integration-tested; it has not been executed against a real team's backlog.
5. **Corporate SSO and deployment remain separate gates.** The e2e uses fixed trusted local personas built from the real application; it does not prove the company's Gateway authentication or header handling.

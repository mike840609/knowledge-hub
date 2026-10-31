# Team space publishing — verification

Date: 2026-10-31 (Asia/Taipei).
Branch: `docs/team-space-publishing`.
HEAD during the post-fix gates: `493db35f` (the independent pre-merge review fix wave). The feature was originally recorded at `f256bf7d`; `7b8f43dd` fixed five Important findings from the final whole-branch review, and the focused team e2e, `make verify`, full integration and team smoke were re-run on it. The independent pre-merge review then found four Critical/Important issues; `493db35f` fixed them and unit, integration, typecheck and lint were rerun (counts below). The browser e2e rows below remain the `7b8f43dd` evidence: the new fixes change event targeting, retention operators, read scoping and team UI visibility, and no e2e flow moves a document out of a published folder. A follow-up reverted the team `/knowledge/new` 404 (see Unresolved limits 6) and re-ran the browser gates; `document.duplicate` stays hidden. A further follow-up removed the create-from-link affordance for unresolved wikilinks in team workspaces (reader, Links panel, local graph and workspace graph), so those links are plain text there; both browser gates still pass.
Spec: `docs/superpowers/specs/2026-10-30-team-space-publishing-design.md`. Plan: `docs/superpowers/plans/2026-10-31-team-space-publishing.md`.

## Scope

- End-to-end workflow with the fixed Phase 3 HTTP personas, against a production build and an isolated MariaDB database: sync, publish, read, comment, Inbox, creator update, join without overwrite, archived-path reattach, membership removal, unpublish.
- The two writer guards, the anonymous share-link guard and the personal review/follow/mention regressions, included in the recorded unit and integration runs.
- Rollout documentation for enable → catch-up → pending save/sync and for unpublish/restore conflicts.

Environment: macOS, Node v24.6.0, Playwright 1.63.0 with the installed Chromium, MariaDB in Docker on port 3307 (the project's isolated test-database harness provisions and disposes its own schema), workers=1. `make browsers` was already satisfied.

## Commands and outcomes

| Command | Result |
| --- | --- |
| `npm run test:e2e -- tests/e2e/zz-team-publishing.spec.ts` | **PASS (post-fix)** — 7 tests, 32.2s in the browser stage; 119.90s including build; zero failed, flaky or skipped. |
| `make verify` | **PASS (post-fix)** — unit **340 files / 4,080 tests passed**; `tsc --noEmit` clean; ESLint clean; production build compiled. |
| `npm run test:integration` | **PASS (post-fix)** — **112 files / 1,135 tests passed**. |
| `npm run test:e2e:smoke` | **PASS (post-fix)** — **15 tests passed**, 42.3s browser stage; 0 failed/flaky/skipped; includes all seven new team flows. |
| `npm run test:e2e:smoke:personal` | **FAIL (pre-existing, not this feature)** — 3 passed, 1 failed: `personal-workspace.spec.ts` → after “Restore revision 1”, the editor shows the recovered draft (“Persistent draft body”) instead of the restored “Original body”. Reproduced identically at `main` `2aada14f` with the same command (3 passed, 1 failed), where none of this feature's code exists. No product or unrelated test was changed to hide it. |
| `npm run test:unit` / `npm run test:integration` / `tsc --noEmit` / `eslint .` (independent review wave, `493db35f`) | **PASS** — unit **341 files / 4,083 tests**; integration **112 files / 1,143 tests**; typecheck and lint clean. |
| `npm run test:unit` / `npm run test:integration` / `npm run test:e2e:smoke` / `npm run test:e2e -- tests/e2e/zz-team-publishing.spec.ts` (composer follow-up) | **PASS** — unit **341 files / 4,084 tests**; integration **112 files / 1,143 tests**; team smoke **15/15**; team publishing e2e **7/7**; typecheck and lint clean. |
| `npm run test:unit` / focused integration / `npm run test:e2e:smoke` / `npm run test:e2e -- tests/e2e/zz-team-publishing.spec.ts` (create-from-link gating) | **PASS** — unit **343 files / 4,091 tests**; focused integration (`publication-links`, `knowledge-link-service`) **2 files / 31 tests**; team smoke **15/15**; team publishing e2e **7/7**; typecheck and lint clean. |

`make verify` initially failed only `tests/unit/e2e-smoke-selection.test.ts`, whose catalog pins the approved Team smoke flows; the seven new approved flows are now declared there. Nothing product-side was corrected by that change.

The final whole-branch review found no Critical issues and five Important ones: team-visible “no longer updated”, reconcile of a pending contribution with no delivery, quadratic publication projection, quadratic sync-notice matching, and missing event/delivery retention. Commit `7b8f43dd` fixed all five and added the retention script; the team e2e, `make verify`, full integration and team smoke were then re-run on that commit and all passed. The commits after these post-fix runs change only this record.

The independent pre-merge review then found one Critical issue (a move out of a published folder never archived the team copy) and three Important ones (default-off retention growth, explorer-wide document reads, and team authoring reachability), plus this record's integration test count was inconsistent between two lines. Commit `493db35f` fixed all of them — including hiding `document.duplicate` and every UI authoring entry point — and the unit and integration totals above are that commit's exact counts. Its team `/knowledge/new` 404 was then reverted: the approved `document-composer-navigation.spec.ts` smoke flow uses a team workspace for the composer, so the page remains URL-reachable while every UI entry stays hidden (Unresolved limits 6). That is the documented residual, not a hidden capability.

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
- Personal review, follow and mention regressions in the integration run: `document-review-service` 25, `review-reply-follow` 16, `review-mentions` 45, `share-comment-notify` 12, `folder-share-mentions` 8 — all passed. The full integration suite (1,135 tests on `7b8f43dd`; 1,143 after the independent review fixes) also covers the publication service, reconciliation, lifecycle, lock order, drain, links, Inbox and API contracts.
- `tests/unit/e2e-smoke-selection.test.ts` — 4 tests passed after declaring the new `@smoke-team` flows.

## Flag and rollout

`KM_TEAM_WORKSPACES_ENABLED` remains default off; this task changes no default and adds no dependency. With the flag off, publication routes answer 404 and team spaces stay closed. The operational order is in `docs/operations/team-workspaces-availability.md` (and the zh-TW companion): deploy, enable and restart, run `make db-catch-up-publications`, then have each reported `pending` contributor save or sync once. That request reconciles a contributor who still holds `source.manage` and freezes one who was removed or demoted; the doc states the expected end state for each. Unpublish/restore/rename conflict behavior and stickiness are documented alongside it, as is the Folder Sync source-root publishing limit.

## Unresolved limits

1. **Personal smoke has one pre-existing failure** (details above). It reproduces on `main` and is unrelated to publication code; this task did not fix it, because doing so would change a different feature without its own design review. The Team smoke is green.
2. **A Folder Sync source's root is not a publishable tree folder.** The import places documents directly under the source, and the tree renders no root folder row, so the UI offers 「發佈到團隊」 only for a folder *inside* a synced source (the e2e publishes `hcm/`). Publishing the whole synced source would need a design decision — a source-as-folder origin, or a real root folder node for imported sources — not a Task 13 fix. The service already accepts any owned folder node.
3. **The e2e exercises direct members only.** Group-only rights are covered by unit/integration tests (pending catch-up, caller-based group judgement), not by a browser persona.
4. **Catch-up was run against isolated test databases, not production data.** The pending-save/sync operator flow is documented and integration-tested; it has not been executed against a real team's backlog.
5. **Corporate SSO and deployment remain separate gates.** The e2e uses fixed trusted local personas built from the real application; it does not prove the company's Gateway authentication or header handling.
6. **Team `/knowledge/new` remains URL-reachable.** The approved `document-composer-navigation.spec.ts` smoke flow drives the composer in a team workspace fixture, so the page keeps its `canWrite` check and renders there; a team-wide 404 broke that flow. No team UI surface offers a new-document, folder, import or duplicate action, and an unresolved `[[wikilink]]` in a team document renders as plain text — no "Create" entry in the reader, the Links panel or the graph — even for a member who may write. Publishing is the only UI path — and the create request is still authorized and refused in words by the service. This is the documented URL-only residual the independent review allowed as the alternative to a 404, not a hidden capability.

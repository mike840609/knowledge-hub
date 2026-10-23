# Draft Recovery and Personal Hardening — Verification

Date: 2026-10-24
Branch: `feat/draft-recovery-personal-hardening`
Plan: `docs/superpowers/plans/2026-10-24-draft-recovery-and-personal-hardening.md`

## DB-free gate

Command:

```bash
make verify
```

Result: **exit 0**

- Unit suite: **256 files, 3,182 tests passed**
- TypeScript: `tsc --noEmit` passed
- Lint: `eslint .` passed
- Build: Next.js production build compiled successfully

## DB-backed E2E

The worktree’s default E2E port was occupied by another worktree, so the run used `KM_E2E_PORT=3120`.

Command:

```bash
KM_E2E_PORT=3120 KM_E2E_PERSONAL_ONLY=true KM_TEAM_WORKSPACES_ENABLED=false \
  npx tsx scripts/test/e2e.ts --grep @smoke-personal
```

Result: **4 passed**

- `a draft survives archiving and can be restored from Home` (new)
- `personal rollout: disabled teams, drafts across browsers, organize, export, restore and favorites`
- `a new-note draft survives closing its tab and can be resumed from Home`
- `root resolves deterministically into My Space`

The existing personal-workspace case was updated for the inline editor: it now seeds the account draft through the personal API, resumes saving, and waits for the document PATCH rather than a removed composer status line/Save button. The draft recovery case seeds a draft, archives the document through the API, opens the recovery page from Home, restores the document, and reads the recovered Markdown back from the editor.

## DB-backed integration

Command:

```bash
make test-integration
```

Result: **exit 0 — 84 files, 764 tests passed**, including the new `tests/integration/personal-favorites.test.ts`:
- a favorite resolves its archived document and source through the real store;
- an archived source still resolves the favorite’s `sourceId`;
- a favorite whose document is missing is dropped;
- removing the favorite returns an empty list.

## Final review fixes

The whole-branch review found no Critical issues and four Important production/code issues plus one Important test gap. The fixes were:

- `getKnowledgeExplorerModel` and `getSourceListModel` now rethrow non-hidden failures instead of turning them into a false “Not found or no access”; a shared `isHiddenReadFailure` classifier also recognizes the plain `DomainError` codes used by the personal service.
- The recovery model reads the document tree and blocks Restore when an ancestor folder is archived or the document has no tree node; the page points the reader to Sources.
- The recovery page no longer promises Restore for a `SOURCE_MANAGED` document; it explains that the synced source owns restoration.
- A DB-backed favorites integration test was added.

The reviewer’s Minor findings were deferred; they are recorded in the plan workspace ledger:
- composer download should flush pending rendered-editor output first;
- the size hint should be announced as a live status;
- add emoji/exact-boundary cases;
- the new E2E URL assertion could be exact instead of suffix-matching;
- the plan’s “Draft · Continue writing” provenance is intentionally not shown for ordinary drafts, because the existing Home test forbids it;
- `getDraftRecoveryModel` reads the document once through `personal.get` and once by id.

## Covered by unit tests, not re-run manually

- A transient document read rethrows and reaches the document Retry boundary; not-found/access still returns the non-enumerating page.
- Draft and publish both enforce the same 5 MiB UTF-8 byte limit, including 2M CJK text; an oversized account draft enters the terminal `too-large` state, keeps its local copy, and resumes after the text shrinks.
- Favorites use `GET /personal?view=favorites`, return identifiers only, and two mounted hooks plus a focus event share one in-flight request.
- Archived-document drafts appear under Home Drafts with `Original document archived` / `Source archived`; active drafts link to the document page, not `/edit`.

## Not run

- The manual browser checks from the plan that need fault injection or a 2M-character paste: the transient read path, the oversized-draft editor hint, and the DevTools focus-request count. Their behavior is covered by unit tests; a full browser fault-injection/manual pass was not performed.
- Production deployment, database migration, and visual/accessibility review were not part of this change.

## Notes

- No database migration is required.
- No new dependency was added.
- Home still reads full draft Markdown server-side to resolve titles; that N+1/query-batching work remains in the separate home-performance plan, as recorded in the plan’s out-of-scope section.

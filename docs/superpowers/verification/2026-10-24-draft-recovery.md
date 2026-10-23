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

- Unit suite: **255 files, 3,172 tests passed**
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

# Saved shares verification

## Delivered behavior

- Authenticated recipients save share links across devices in Shares → Saved shares.
- My shares preserves outgoing-link management, copying, view totals and revocation.
- Ordinary favorites, source ownership, content counts, search and Insights are unchanged.
- Saving links does not copy content or grant access to the sender's workspace.
- Unavailable links expose save-time snapshots, suppress new private metadata,
  remain removable, and never disclose the cause of lost access except public expiry.
- API mutations require a trusted caller and the configured same origin. Responses
  are private/no-store. Anonymous reading continues when sign-in is unavailable.
- English/Traditional Chinese guides explain Save share, Saved shares and favorites.

## Verification results

| Check | Result |
| --- | --- |
| Full unit suite (`npm run test:unit`) | 178 files, 2,138 passed |
| Full isolated integration suite (`npm run test:integration`) | 79 files, 716 passed |
| TypeScript (`npm run typecheck`) | Passed |
| ESLint (`npm run lint`) | Passed after replacing native hidden input with Input |
| Production build (`npm run build`; final E2E production builds) | Passed |
| Saved shares + existing sharing/review Playwright specs | 7 passed |
| Final screenshot/recipient flow rerun | 1 passed; 16 timezone-aware captures; no horizontal overflow |

The new service tests were first run against unimplemented methods (9 failures)
and then passed against the MariaDB implementation. Query validation likewise
failed before its implementation. API boundary/routes, bookmark control and
saved-list/guide cases were run red before green.

Additional regressions were reproduced and fixed: late auth-error JSON parsing
from a previous article overriding the new article's state; a refresh hiding
links re-saved on another device; saved-share not-found errors mapping to 500;
and production Next Request proxies breaking origin checks without force-dynamic.
The latter failed in actual browser saves, then passed in the production E2E run.

The sharing suite deliberately exercises an unconfigured identity provider and
prints expected AUTH_UNAVAILABLE diagnostics. These are negative-path evidence,
not unexpected application failures. Production sign-in still depends on the
deployment's trusted identity adapter; no new login provider was added.

Commands:

```bash
npm run test:unit
npm run test:integration
npm run typecheck
npm run lint
npm run build
PLAYWRIGHT_BROWSERS_PATH=/workspace/.playwright-browsers KM_E2E_BUILD_CACHE=true \
  npm run test:e2e -- tests/e2e/saved-shares.spec.ts tests/e2e/share-link.spec.ts tests/e2e/shared-review.spec.ts
PLAYWRIGHT_BROWSERS_PATH=/workspace/.playwright-browsers KM_E2E_BUILD_CACHE=true \
  KM_SAVED_SHARE_SCREENSHOTS=/workspace/artifacts/saved-shares \
  npm run test:e2e -- tests/e2e/saved-shares.spec.ts --grep 'recipient saves'
```

## Implementation adjustments

1. Used the existing dedicated feature branch/checkout without creating another
   worktree. This confines commits to the feature branch but changes the current
   checkout, so another simultaneous task must use a separate checkout.
2. Kept an ignored progress ledger and invoked test/commit steps directly because
   remote skill scripts were not available as executable files. Progress automation
   is manual; verified results and decisions are retained in this record.
3. For targeted integration runs, used an ignored helper that reuses repository
   isolated-database provisioning and migrations. The normal runner does not
   forward file arguments; the final full suite used the standard runner.
4. Covered schema behavior with real service integration writes/concurrent saves
   rather than an implementation-mirroring schema snapshot. Foreign-key/table
   structure is reviewed in the migration; no separate schema snapshot file exists.
5. Added force-dynamic to all recipient API routes, matching existing review routes.
   Without it, production Next Request proxies break the native URL getter used
   by the origin validator, resulting in 500 responses instead of working saves.

6. Added a single-statement snapshot-read port for save validity and metadata.
   Separate READ COMMITTED reads could otherwise capture a private title published
   after revocation. The snapshot includes grant inputs and only title/sender
   metadata; no article body is copied.

## Final independent review

One fresh-context reviewer examined the whole branch against the agreed spec,
plan and five review-focus scenarios. It found three Important issues, no
Critical issues and no deferred Minor issues. All three were addressed in one
fix pass with reproductions observed failing before the fixes:

- Original saved title/sender stopped matching after a live article was renamed.
  `search matches saved metadata and currently public metadata after a rename`
  now passes. Invalid rows still cannot match later private metadata.
- After another-tab sign-in, the existing Save control stayed signed out.
  `can save after sign-in completes in another tab without reloading the article`
  now passes; the explicit mutation rechecks the trusted identity.
- Revocation plus a private revision between validation and metadata retrieval
  could persist the private title as a saved snapshot.
  `never snapshots a private title published between validation and metadata capture`
  reproduced that leakage and now passes with one consistent snapshot read.

After the complete fix pass: unit 2,138/2,138, integration 716/716, production
sharing/review E2E 7/7. Typecheck and lint were rerun after the build finished.
An earlier concurrent typecheck saw TS6053 while the E2E build regenerated
`.next/types`; sequencing verification resolved it without a product-code change.

The development database was additionally upgraded through the existing additive
migrations from schema 13 to 19 with `npm run db:migrate`; the applied ledger
and saved-share table were verified. No documents were deleted or rewritten.

## Screenshots

Sixteen synthetic desktop/mobile light/dark screenshots are in
`docs/ui-comparisons/saved-shares/`. Browser timestamps use Asia/Taipei; all
captures include a no-horizontal-overflow assertion. Public reader Save/Saved,
My shares and Saved shares were captured. The synthetic databases were disposed
by the test runner; screenshots contain no real content or active real grants.

## PR #167 review follow-up

The follow-up review identified three contract/coverage issues. All were addressed:

- Added an explicit trusted-caller guard for every public SavedShareService entry,
  including reads through the snapshot port. A temporary caller-less `peek(token)`
  mutation caused the new test to fail while the existing nine checks passed;
  restoring the safe service made all ten boundary checks pass.
- Updated CLAUDE.md to document the third token-driven path: authenticated,
  recipient-owned saved-share metadata. The two anonymous entries remain the only
  caller-less exceptions, and saving never grants workspace search or membership.
- Reused `tabListClasses` and `tabClasses` for query-based Shares navigation,
  preserving route links and aria-current while aligning with the tab contract.

Also added the saved-shares canonical row to README.zh-TW.md and corrected the
plan's nonexistent schema-test filename/checked-step description. Schema shape
is reviewed in the migration; no separate automated schema snapshot test is claimed.

Fresh local verification after these edits:

| Check | Result |
| --- | --- |
| Full unit suite | 178 files, 2,139 passed |
| Full isolated MariaDB integration suite | 79 files, 716 passed |
| Saved-shares production E2E | 3 passed |
| Typecheck and full lint | Passed |
| Production builds used by E2E | Passed |

Original-head GitHub CI at bbda6df was also independently inspected:
https://github.com/mike840609/knowledge-hub/actions/runs/38188336043
Unit, integration, build, both E2E shards and the aggregate E2E gate all passed.
The external review's inability to run DB/browser checks in its own environment
is distinct from these recorded local and CI results.

### MariaDB query plan

Ran EXPLAIN FORMAT=JSON against the actual repository list SQL in an isolated
MariaDB database, using 150 synthetic share links/saved rows across recipients.
The target recipient owned five rows; the returned list contained those five.

- Recipient table `b`: range access through `idx_saved_share_recipient`, estimated 5 rows.
- Link/document/revision/source/workspace/membership/user joins: `eq_ref` on PRIMARY,
  estimated one row per lookup.
- Neither derived table was materialized; the plan did not scan all share links.

This is evidence for the tested MariaDB configuration/data distribution, not a
promise that every future optimizer configuration or production distribution
selects the same plan. All synthetic rows and the isolated database were disposed.

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
| Full unit suite (`npm run test:unit`) | 178 files, 2,137 passed |
| Full isolated integration suite (`npm run test:integration`) | 79 files, 714 passed |
| TypeScript (`npm run typecheck`) | Passed |
| ESLint (`npm run lint`) | Passed after replacing native hidden input with Input |
| Production build (`npm run build`) | Passed |
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

## Screenshots and review

Synthetic desktop/mobile light/dark screenshots are in
`docs/ui-comparisons/saved-shares/`. Whole-branch review and any findings will be
recorded here before delivery.

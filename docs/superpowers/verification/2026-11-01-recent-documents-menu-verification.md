# Recent documents menu verification

Implementation: `dc7af7c2`.

- Full unit suite: 331 files, 3,976 tests passed on the final implementation.
- Focused suite: 31 tests passed, including 10 Recent menu cases.
- `npm run typecheck`: passed.
- Targeted ESLint on changed source and test files: passed.
- `git diff --check`: passed.
- `npm run test:e2e -- retrieval-page-icons.spec.ts`: final production build and
  browser test passed. Checks include absence of inline Recent, keyboard opening,
  icon parity, article navigation and menu closure, updated history on reopening,
  Escape focus return, and toolbar/menu accessibility in the 1100px drawer.
- Regression evidence: missing clock/inline list/loading tests failed before the
  implementation; unloaded-source links disappearing during background history
  reorder also failed before metadata request keys were stabilized.

Author self-review checked open/close lifecycle, delayed history hydration,
metadata retry, stable request IDs, filtering, read-only cues, and unchanged
Favorites/general tree positioning. No blocking issue identified.

Independent review was attempted but the review agent failed due to a usage
limit before producing findings. This is an author self-review, not independent
review approval. No remote push, merge, or deployment was performed.

## PR #320 review follow-up

Both P2 findings were reproduced by three failing regression cases and fixed:

- An open empty history snapshot accepts its first nonempty history update,
  then preserves its order until the menu is reopened.
- Recent metadata has its own request/loading/error/retry state, independent
  of Favorites. Unrelated favorite additions cannot clear unloaded-source
  recent links while the favorite request is pending or fails.

Follow-up validation: 331 unit files / 3,979 tests passed; 18 focused tests
passed; production build and retrieval-page-icons browser test passed;
TypeScript, targeted ESLint, and diff checks passed. The first standalone
TypeScript invocation overlapped the browser build clearing generated
`.next/types`; rerunning sequentially after the build passed.

## Second review follow-up

Updated retrieval-layout E2E coverage to use the clock menu, including desktop
and mobile history navigation and closed-menu state on drawer reopening/reload.
The menu now freezes only after a display-eligible link has appeared, rather
than after capturing nonempty raw history. Three regression cases cover history
containing only the current document, favorites, or unavailable documents.

Local validation: 3,982 unit tests passed; all seven retrieval-layout and
retrieval-page-icons E2E tests passed after a production build. TypeScript,
targeted ESLint, and diff checks passed. The metadata query duplication concern
(P3) is deferred; query caching/optimization is outside this correction.

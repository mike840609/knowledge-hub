# React #310 After a Redirect Lands During Navigation — Verification Record

| Item | Details |
| --- | --- |
| Date | 2026-10-06 |
| Subject | Second fix in `patches/next+15.5.25.patch` (React error recovery); [`router-redirect-during-navigation.spec.ts`](../../../tests/e2e/router-redirect-during-navigation.spec.ts), [`vendored-react-ping-fix.test.ts`](../../../tests/unit/vendored-react-ping-fix.test.ts) |
| Environment | macOS; Node 24.6; MariaDB on `127.0.0.1:3307`; Playwright Chromium; Next 15.5.25 vendoring React `19.2.0-canary-0bdb9206-20250818` |
| Conclusion | Root cause found by instrumentation; fixed by porting facebook/react#36911. RED/GREEN shown for unit and e2e; full e2e 278 passed, 2 skipped |

## 1. Symptom

`sample-wiki-import.spec.ts` failed in the full e2e suite, but not alone. After Preview, Apply, and "Browse documents", the test clicked a document in the tree. The page then showed "Application error: a client-side exception has occurred". The page error was `Minified React error #310` ("Rendered more hooks than during the previous render"), thrown from `useMemo` in Next's own `Router` (`app-router`), not from app code. The same failure reproduced on `main` (`12bf10c`) through the ordinary folder picker.

## 2. Root cause

Each step was observed with `console.log` probes injected into the built react-dom chunk (`next build --no-mangling`, probes in the build output only):

1. `/knowledge/<sourceId>` redirects on the server to the first document. That page sits behind `loading.tsx`, so on a client navigation the tree commits first. The redirect arrives later and is thrown during render in a Retry lane.
2. A click on another document makes Next call `setState(pendingPromise)` in a transition. The Router suspends on it (`use(state)`).
3. The `NEXT_REDIRECT` throw starts React's synchronous error-recovery render. That render retries **all** pending lanes (`root.pendingLanes`), so it includes the click's navigation.
4. In the retry, the Router suspends at the shell (exit status 6) with a ping listener attached. Recovery turns this into status 4, and because the lanes include the non-transition Retry lane, React **commits the incomplete tree** (`commitsIncomplete=true`).
5. The committed Router holds only the hooks it ran before suspending. When the navigation resolves, its next render throws #310.

The repo's earlier ping fix (§9 of the [knowledge-graph verification record](2026-09-29-personal-workspace-knowledge-graph-verification.md)) is not involved: with that hunk reverted in the build, the crash still reproduced 3/3. The full suite's leftover data only widened the timing window (slower server work behind the redirect).

**Fix.** The condition from facebook/react#36911, which treats status 6 like an error in `recoverFromConcurrentError` so the root stays suspended. It is applied to the four `react-dom` builds the ping fix already patches: `react-dom-client.{production,development}.js` and `react-dom-profiling.{profiling,development}.js`.

## 3. Minimal reproduction

The steps:

1. Create a folder source with ≥2 documents.
2. Open the source and click "Browse documents".
3. Before the redirect lands, click another document whose response is still loading.

The e2e spec enforces this order with events, not timers:

- The `NEXT_REDIRECT` RSC row is held until the click has started its navigation and the main thread is idle, meaning the Router is waiting on that navigation.
- The document responses are held until the redirect has been delivered and rendered (idle again).
- The spec asserts that the click landed while the redirect was held and that no safety timeout fired.

## 4. Patch applies to pristine Next

In a scratch directory outside the repo:

| Step | Command | Result |
| --- | --- | --- |
| Pristine package | `npm pack next@15.5.25`, extracted to `node_modules/next` | Ping marker ×1, recovery marker ×0 in each of the 4 files |
| Apply | `node_modules/.bin/patch-package` (the repo's binary) with the new patch | exit 0, `next@15.5.25 ✔`; ping ×2, recovery ×1 in all 4 files |
| Re-apply | same command again | exit 0, no change |
| Strict | `patch-package --error-on-fail` | exit 0, no change |

The patch was regenerated with `patch-package next` from pristine + the old patch + the four edits. The old hunks are byte-identical. This worktree was moved with `patch-package --reverse` (the four files then equal pristine), followed by `patch-package`.

## 5. RED / GREEN

**Unit test** (`vendored-react-ping-fix.test.ts`, error-recovery block):

| Condition | Result |
| --- | --- |
| Old patch only | 4 failed, 4 passed |
| New patch | 8 passed |

**e2e** (`router-redirect-during-navigation.spec.ts`, event-driven version):

| Condition | Result |
| --- | --- |
| Old patch only (`main` state) | 3/3 failed: "Application error", #310 in the trace |
| New patch | 3/3 passed |
| New patch, every CPU core running a busy loop | 3/3 passed |

**Other suites:**

| Suite | Result |
| --- | --- |
| `make verify` | exit 0 |
| mvp trio + sample-wiki + new spec | 11/11 passed |
| Full e2e run 1 | 277 passed, 2 skipped, 1 failed (§6) |
| Full e2e run 2 | 278 passed, 2 skipped |

## 6. Not verified

- The upstream references come from fetched pages read as summaries, not reproduced here:
  - facebook/react#36911: the diff and description were read.
  - vercel/next.js#95368: the React upgrade that includes it.
  - Issues facebook/react#33580, vercel/next.js#63121 and #78396.
- The one-off failure of `phase2.5-knowledge-explorer.spec.ts:66` in full run 1 is explained by **inference**, not observation. The failed test's `page.goto` to a redirecting URL answered 200 (a streamed redirect, for which Next emits `<meta http-equiv="refresh" content="1;url=…">`). About 1 s later the browser loaded the redirect target as a document and discarded the test's click. The meta tag was not seen in the trace's DOM snapshots. The test passed in the earlier full runs, passed alone 3/3, and passed in full run 2.
- The `react-dom-experimental` copies are not patched; this app does not load them.

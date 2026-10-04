# Lost Navigation after Saving — Measurement Record

| Item | Details |
| --- | --- |
| Date | 2026-09-22 |
| Type | Measurement record (actual run data, not a proposal) |
| Conclusion | A `router.refresh()` immediately after `router.push()` discards the navigation it is intended to refresh |
| Fix | Remove that line in `src/components/knowledge/document-editor.tsx` |

## 1. Symptoms

After clicking Save in the document editor, PATCH succeeds, but the reader remains in the editor and the document page never appears.

This appeared in CI as a `phase5-authoring` timeout and locally in the complete e2e suite roughly once every two runs. It had always been treated as “test flakiness under load”—the spec's file-header comment even recorded that these assertions had “also failed on `main`.” **It is a real bug, with a trigger probability related to load.**

## 2. Measurement method

Production build (`next start`), rather than a dev server; no browser-side instrumentation of the app. Every signal is externally observable:

- PATCH requests
- App Router RSC requests (`RSC: 1` header), distinguishing the push destination from the refresh's current page by path and prefetch by the `next-router-prefetch` header
- `framenavigated` events
- Final URL

30 runs per batch, recording **median PATCH occurrence time** as a load proxy—this failure is extremely load-sensitive (the same code has measured 20%, 35%, and 70% at less busy times), so two batches are comparable only under similar load.

## 3. Shape of the failure

```text
Success: PATCH · destination-page RSC · NAV → document page
Failure: PATCH · destination-page RSC · (nothing further)
```

The payload was fetched; navigation never committed.

This also ruled out two original suspects:

- **Background-tab throttling** — the failing test opens only one tab and can fail without a second tab.
- **Authorization polling sending another refresh** — there is no RSC request to the current URL after PATCH; that path leaves no network trace.

## 4. A/B/A comparison

Interleaved runs using the same script, machine, and time period:

| Batch | `router.refresh()` | Stuck / total | Rate | Median PATCH |
| --- | --- | --- | --- | --- |
| A1 | Present | 5 / 30 | 17% | 831ms |
| B1 | Absent | 0 / 30 | 0% | 821ms |
| A2 | Present | 5 / 30 | 17% | 830ms |
| B0 (earlier) | Absent | 1 / 30 | 3% | ~850ms |

The load proxy is nearly identical across three batches (821–831ms), making this comparison defensible. Totals: **present 10/60, absent 1/60.**

A1 and A2 produced exactly the same 5/30, showing good reproducibility.

## 5. Why removing it is correct, beyond merely effective

That `router.refresh()` was presumably intended to ensure the document page shows the new revision rather than cached content. **It is redundant**: network records show every push actually fetching the destination route's RSC payload after PATCH, rather than replaying an earlier prefetch. Freshness comes from push itself.

The test also proves this—`edits a hub-managed document` asserts that `updated body` appears on the page, beyond checking the URL. After the fix, the test passed 20 consecutive runs (3 failures out of 20 before the fix).

Redundant + harmful = remove.

## 6. After the fix

- Previously failing test: 20/20 passed (previously 3/20 failed)
- Complete e2e suite: two consecutive 77/77 passes (previously failed roughly once every two runs)
- `make verify`: 369 unit tests, typecheck, lint, and build all passed

## 7. What was not done

`use-workspace-authorization` was left untouched. It was once a suspect, but measurements ruled it out, and it is shared code traversed by every page—changing it without evidence would wager the whole app on a guess.

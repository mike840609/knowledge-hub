# Navigation Latency — Measurement

**English** | [繁體中文](2026-09-21-navigation-latency-measurement.zh-TW.md)

| Item | Details |
| --- | --- |
| Date | 2026-09-21 |
| Type | Measurement record (evidence, not a decision) |
| Version tested | `main` @ `930290b` |
| Motivation | Contract Open item 6 described navigation as “the largest perceived gap and the only architecture issue,” requiring measurement before choosing a prefetch/caching strategy |
| Conclusion | **That description was wrong. The bottleneck is our own skeleton screen, rather than the server or prefetch.** |

## Method

Production build, real database, one Chromium instance. The measurement concerns switching between documents in the knowledge tree (`/w/:ws/knowledge/:src/:doc`).

The three numbers come from separate tools to avoid contaminating one another:

- **Time until content enters the DOM**: an in-page `MutationObserver`, reset before clicking. Playwright locator assertions are not used—they include the polling interval; part of the initially measured 412ms was this artifact.
- **Network time**: `PerformanceResourceTiming`'s `responseEnd`, covering the RSC response and the client's two `/api/workspaces` calls.
- **JS execution time**: `PerformanceObserver`'s `longtask`.

## Results

Each number has n=6, using the same method.

| | p50 | max |
| --- | --- | --- |
| Content enters DOM | **383ms** | 403ms |
| Last network byte | ~130ms | 171ms |
| Total long-task duration | **0ms** | 0ms |

Measured separately on the server (same route, bypassing the browser): **RSC 48ms, full HTML 65ms** (median of 5 runs each).

In other words: **all data has arrived by ~130ms, the main thread is doing no work at all, yet content does not appear until 383ms. The intervening 250ms is pure waiting.**

The length of that wait is unusually consistent—347, 350, 351, 351, 347ms—a timer's signature, rather than variable workload.

## Controlled experiment

Remove the two skeleton screens in the document area (the route's `loading.tsx` and the `knowledge-layout` `Suspense` fallback), changing nothing else and using the same measurement method:

| | p50 | max |
| --- | --- | --- |
| With skeleton screens (current behavior) | 383ms | 403ms |
| Without skeleton screens | **141ms** | 193ms |

**2.7 times faster.** Network time is the same on both sides.

## Why

Next's `<Link>` prefetches the **loading boundary** of dynamic routes by default, but does not prefetch page data. The skeleton therefore appears immediately on click, while data arrives ~130ms later.

To avoid flicker, React throttles the switch from a Suspense fallback to content: once a fallback appears, it is not immediately replaced. Consequently, **showing a skeleton for a 130ms wait makes the user wait another 250ms**.

The skeleton itself is the delay.

## What this overturns

Contract Open item 6 says “measure before deciding a prefetch/caching strategy; this is not a CSS change.” The measurements show:

- prefetch can save at most part of ~130ms, **not the main cost**
- the same applies to caching
- no architecture issue needs to be addressed

The real lever is a design decision: **what to show during a 130ms wait.** This is on the scale of deleting one file, rather than refactoring.

## Decision: retain the skeleton screens

The design decision after measuring was to **retain the skeleton screens**, leaving code unchanged. This choice was made with awareness of its cost; the cost was not overlooked.

This is recorded here because the numbers look like a recommendation to act, while the conclusion is to take no action. The next person seeing 383ms and “2.7 times faster” should also see that this has already been decided.

Two facts established at the time are also recorded to avoid repeating the investigation:

- **There is no intermediate option.** A delayed or initially hidden fallback still commits, and committing unmounts the previous document—resulting in a blank area, worse than a skeleton.
- **The only lever that retains skeletons while removing the cost** is prefetching document data itself (currently only the loading boundary is prefetched). If data is already in the router cache, navigation never reaches the fallback. **This has not been measured**; the cost is one additional prefetch request per visible tree node.

## A correction to the method

The first version measured 412ms, partly from **the polling interval of the Playwright assertion used to measure it**—the tool entered the result. The final numbers use an in-page `MutationObserver`, read with `waitForFunction`, keeping the measurement tool out of the result.

The difference between 412 and 383 is small, but the methodological difference is that the former cannot answer “what is that 250ms?” and the latter can.

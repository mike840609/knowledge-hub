# One Sidebar — Latency of Entering a Workspace

| Item | Details |
| --- | --- |
| Date | 2026-10-14 |
| Type | Measurement record (evidence, not a decision) |
| Versions tested | Before: `0713728` (the commit `feat/sidebar-adjust` started from). After: `feat/sidebar-adjust` @ `4d09aef` |
| Motivation | [The spec](../specs/2026-10-14-notion-sidebar-design.md) moves every source's tree into the workspace layout, so entering a workspace reads trees that only Knowledge pages read before. Its Risk section names the fallback (read each tree when its section is first expanded) and says this measurement decides whether it is needed |
| Conclusion | **On the seeded workspaces the cost is +5 to +7ms and the fallback is not needed. The cost is linear in documents, though: with 400 documents in one workspace it is +137ms to content and a ~110ms main-thread task. Whether that matters depends on real workspace sizes, which this record does not know. The fallback is not built.** |

## Method

Reuses the [2026-09-21 navigation latency measurement](./2026-09-21-navigation-latency-measurement.md): production build, real MariaDB, one Chromium, and three separate tools so they do not contaminate each other.

- **Content enters the DOM**: an in-page `MutationObserver` installed before navigation; the time at which `main h1` first exists (the page's `PageHeader`). No Playwright locator polling.
- **Network and navigation**: `PerformanceResourceTiming` / `PerformanceNavigationTiming` (`responseStart` = TTFB, `responseEnd`, `encodedBodySize`/`decodedBodySize`, last `responseEnd`, request count), plus the `first-contentful-paint` entry.
- **JS execution**: `PerformanceObserver` `longtask`, buffered.

What is measured is a **cold load** of `/w/<id>/home` in My Space and `/w/<id>/graph` in Query Master: a fresh browser context per run (no HTTP cache, no router cache), a warm server. Two warm-up loads per route are discarded.

Controls, so the only difference is the code:

- Both sides were built (`next build`) and served by `next start` on the **same port (3100), one server at a time**, against **the same database** and the same environment (`KM_IDENTITY_PROVIDER=local`, `KM_ALLOW_LOCAL_IDENTITY_IN_PRODUCTION=true`, `KM_TEAM_WORKSPACES_ENABLED=true`, because Query Master is a Team workspace). The baseline is a detached worktree of `0713728` with its own `npm ci` and build.
- Order **branch, baseline, baseline, branch**, n=10 per route per block, so n=20 per side per route after pooling, with the same n on both sides. This keeps a drift in machine load from landing on one side.
- Server-only numbers: `curl` against the same route, bypassing the browser, n=10 each, p50.
- No run errored and none was retried (the harness retries up to 3 times and counts none of them; the retry log was empty). No "Too many connections".

Load conditions: other local worktrees share this MariaDB and this machine. macOS load average was 3 to 5 during the runs and reached 8.7 at the end of the last branch block of the seeded measurement; MariaDB had 11 connections open (this server's pool) when the runs began. The seeded p50s of the two blocks per side agree within 2ms (TTFB p50: before 53.9 / 52.5, after 57.6 / 56.3 on Home), so the load did not move the medians; it shows in the max column.

### Two data sets

1. **Seeded (the dev database as it is).** My Space: one source (`範例知識庫`, folder sync, 10 tree nodes, 8 document rows in the sidebar). Query Master: three sources, one archived, 6 nodes in all (5 rows in the sidebar). This is what the spec called "entering Home".
2. **Scaled (a probe, to bound the risk).** A clone of the dev database (`hcm_km_scale_probe`, dropped afterwards; the dev database was not changed) with documents added through the product's own `POST /api/workspaces/:id/folders` and `/documents`: My Space +10 folders × 40 documents (407 rows in the sidebar), Query Master +5 folders × 40 documents (204 rows). Same method, same n, same order.

## Results

Each number is n=20 (two blocks of 10), p50 with max in brackets, ms unless stated.

### Seeded

**My Space `/home`**

| | Before | After | Difference |
| --- | --- | --- | --- |
| TTFB | 52.5 (62) | 57.1 (115) | **+4.6** |
| Content enters DOM (`main h1`) | 62.1 (73) | 66.8 (129) | **+4.7** |
| First contentful paint | 92 (132) | 114 (200) | +22 |
| Load event | 124 (201) | 144 (249) | +20 |
| Last network byte | 197 (326) | 250 (460) | +52 |
| Requests | 47 | 51 | +4 |
| HTML, decoded / encoded | 43 KB / 11.4 KB | 75 KB / 14.1 KB | +32 KB / +2.7 KB |
| Total long-task time | 0 (0) | 0 (0) | none in 20 runs |
| Server only (curl, p50) | 31 | 40 | +9 |

**Query Master `/graph`**

| | Before | After | Difference |
| --- | --- | --- | --- |
| TTFB | 25.4 (33) | 31.5 (42) | **+6.1** |
| Content enters DOM (`main h1`) | 37.8 (88) | 44.9 (65) | **+7.1** |
| First contentful paint | 52 (104) | 72 (108) | +20 |
| Load event | 76 (117) | 101 (170) | +25 |
| Last network byte | 141 (236) | 176 (251) | +35 |
| Requests | 37 | 41 | +4 |
| HTML, decoded / encoded | 37 KB / 10.4 KB | 58 KB / 12.7 KB | +21 KB / +2.3 KB |
| Total long-task time | 0 (0) | 0 (0) | none in 20 runs |
| Server only (curl, p50) | 9 | 14 | +5 |

Raw per-run `main h1` times, in run order, block 1 then block 2:

```text
My Space /home      before  50.8 67.2 66 60.4 65.6 73.3 47.8 67 61.5 61.6 | 61.3 66.4 60.6 58.9 62.6 62.5 67.6 59.5 58.4 68.3
                    after   66.5 96.7 69.7 65.7 64.2 50.6 69.9 68 128.5 66.5 | 66.2 68.8 71 67.1 100.5 61.2 64.3 67.3 48.5 65.3
Query Master /graph before  39.5 38.7 38.8 37.6 37.9 34.4 38.6 36.8 38.1 25.3 | 36.8 26.7 87.6 38.5 35.1 36.9 38.9 35.3 35.8 52.1
                    after   35.3 47.1 46.9 45.3 44.4 45 44.3 42.5 43.2 43.9 | 46.3 45.9 30.2 43.7 65.3 46.4 44.8 45 30.7 46.4
```

### Scaled (407 and 204 sidebar rows)

**My Space `/home`, 407 rows**

| | Before | After | Difference |
| --- | --- | --- | --- |
| TTFB | 63.1 (71) | 147.1 (257) | **+84.0** |
| Content enters DOM (`main h1`) | 73.4 (86) | 210.2 (342) | **+136.8** |
| First contentful paint | 104 (120) | 212 (344) | +108 |
| Load event | 137 (156) | 284 (443) | +147 |
| Last network byte | 220 (299) | 658 (840) | +438 |
| Requests | 47 | 58 | +11 |
| HTML, decoded / encoded | 165 KB / 21.4 KB | 1554 KB / 67.1 KB | +1389 KB / +45.7 KB |
| Total long-task time | 0 (53); 1 of 20 runs had one | **111.5 (223); 20 of 20 runs** | +111 |
| Server only (curl, p50) | 37 | 128 | +91 |

**Query Master `/graph`, 204 rows**

| | Before | After | Difference |
| --- | --- | --- | --- |
| TTFB | 24.5 (31) | 67.7 (249) | **+43.2** |
| Content enters DOM (`main h1`) | 39.5 (147) | 88.2 (277) | **+48.7** |
| First contentful paint | 56 (64) | 132 (324) | +76 |
| Load event | 78 (105) | 161 (359) | +82 |
| Last network byte | 143 (224) | 426 (711) | +282 |
| Requests | 37 | 49 | +12 |
| HTML, decoded / encoded | 105 KB / 17.1 KB | 805 KB / 40.8 KB | +700 KB / +23.7 KB |
| Total long-task time | 0 (0) | 0 (114); 1 of 20 runs | +0 at p50 |
| Server only (curl, p50) | 10 | 64 | +54 |

Raw per-run `main h1` times, same order:

```text
My Space /home      before  77.2 73 77.7 77.5 67.4 73.7 79.5 82 76.8 72.8 | 66.9 71.5 74.1 64 65.7 71.1 81.8 73 65 85.7
(407 rows)          after   204.7 210.3 197.1 227 206.4 206.5 212.5 216 228.9 342.2 | 214.2 210.2 220.1 316.7 206.2 207.6 203.9 197.2 204.9 210.2
Query Master /graph before  39.1 28.5 32.4 44.4 114.2 39.8 40.2 40.6 36.8 38.2 | 41.1 39.9 28.5 39.2 40 37.3 40.5 147 38.2 36.1
(204 rows)          after   88.1 98.5 95.1 87.3 88.3 87.3 78.9 276.7 106.8 89.3 | 88.7 86.5 92 87.5 127 85.3 74.7 83.2 147.3 82
```

## What the numbers say

- **The extra cost is on the server, before the first byte.** The workspace layout awaits both models (`Promise.all`), and the page's `h1` is in the server-rendered HTML, so content-in-DOM follows TTFB by a constant ~10ms on both sides. The scaled TTFB and curl differences agree (+84 vs +91, +43 vs +54): the added time is the explorer read and render, not the browser.
- **It is linear in documents.** TTFB grows ~0.21ms per sidebar row on both pages (84ms / 407 rows, 43ms / 204 rows). Content-in-DOM on Home grows ~0.34ms per row, because the client also hydrates the rows: a ~110ms main-thread task appears in every Home run at 407 rows and was absent on the seed and on the baseline.
- **Each row costs ~3.4 KB of decoded HTML** (+1389 KB for ~400 rows; the tree is in the markup and again in the RSC payload), ~0.11 KB compressed. At 407 rows the document is 1.5 MB decoded.
- **The seed is a floor, not a typical workspace.** Its trees hold 1 to 10 nodes. At that size the whole feature costs +5 to +7ms to content and no long task.
- The seeded **first-contentful-paint, load and last-byte** differences (+20 to +50ms) are larger than the TTFB difference. The page now ships and runs the sidebar's code on every workspace route (4 more requests); FCP is reported in whole milliseconds, and these three move with machine load more than TTFB did. They are reported, not explained further.

## Is the spec's fallback needed?

For the workspaces that exist in the dev database, no: entering costs +5 to +7ms. The cost is linear and at 400 documents in one workspace it is +137ms to content and ~110ms of blocked main thread on Home, so the fallback (read the source list in the layout, each tree when its section is first expanded) becomes needed once real workspaces reach a few hundred documents. This record does not know how big the real ones are, so **the decision is left to the person who does; the fallback is not built.**

## Not measured

- Warm in-workspace navigation. The layout is not re-fetched when navigating inside a workspace, so it should be unchanged; it was not re-measured here.
- `router.refresh()`. Every tree mutation calls it, and it re-runs the workspace layout, which now reads every tree rather than one source's. Each create, rename, move or archive therefore pays this record's "after" cost again. Not measured.
- A workspace with many sources. The probe grew the number of documents, not sources; the per-source reads run in parallel.
- Client-side switching between workspaces (`AppShell key={workspaceId}` remounts). Only cold loads were measured, as asked.

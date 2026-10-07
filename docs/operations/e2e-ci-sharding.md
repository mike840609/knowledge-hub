# E2E CI sharding

CI runs the full Team-enabled suite in two independent jobs. Each shard owns its MariaDB service, isolated database, application builds, and server processes. Group 1 owns every file requiring SSO personas; group 2 builds only the local application. Playwright retains `workers: 1` and `fullyParallel: false` because tests share workspace state inside each job.

Run a shard locally with the normal database prerequisites:

```sh
KM_E2E_GROUP=1 npm run test:e2e -- --reporter=list,blob
KM_E2E_GROUP=2 npm run test:e2e -- --reporter=list,blob
```

`KM_E2E_GROUP` selects a deterministic file group in Playwright config. Native Playwright `--shard` remains available for local experiments; do not combine it with `KM_E2E_GROUP`. Only required application services are prepared. CI installs Chromium headless shell with `--only-shell`.

Each shard uploads `e2e-test-results-<index>` with traces, sanitized test/runner JSON, and Playwright blob results. Uploads overwrite that shard’s prior artifact, so full reruns use fresh results while rerunning only failed jobs retains the successful shard’s results. Each group independently records the full, unfiltered Playwright discovery IDs, commit SHA, and installed Playwright version in `discovery.json`. The final `e2e` job preserves the original check name, requires both discovery manifests to agree with each other and the current commit/version, verifies the union of recorded test IDs against that full discovery, rejects missing/duplicate/failed/flaky tests or incomplete runners, and merges the blob reports into HTML. Existing intentional skips remain visible in the counts; tests are not removed to shorten CI.

Compare browser time, runner stages, the slowest shard, and total CI runner usage over multiple runs before increasing the shard count. The allocator in `scripts/test/e2e-shards.ts` uses file durations recorded in `scripts/test/e2e-durations.json` and adds a 25-second SSO build allowance to group 1. It places the longest remaining files in the lighter group, with deterministic filename tie-breaking. New files receive a 5-second fallback weight; files referencing SSO personas are always placed in group 1. Update the checked-in timings from successful full CI reports when the workload changes. This placement changes file groups while retaining alphabetical execution inside each group. Keep empty-workspace tests before tests that populate the same user's workspace. Changes to test ordering must be checked in the complete shard, not just the edited spec.

Compiler caches are restored per platform, shard, dependency/configuration hash, and application/SSO fixture source hash. Main `.next/cache` and SSO `.cache/e2e-sso` are separate. Only compiler caches are persisted: each application is still built, and no `.next/BUILD_ID`, server bundle, or test database is reused. `KM_E2E_BUILD_CACHE=true` enables copying the SSO compiler cache into and out of its isolated temporary application. SSO temporary paths can limit cache reuse; compare cold and warm runs rather than assuming a fixed speedup.

Reading-link fixtures create documents through the API and explicitly navigate to the document under test. Document creation and rename UI coverage remains in the authoring tests and the rename scenario. Recent/favorite fixtures already create documents through the API; workspace lookup also uses the API, while reading and starring remain UI actions. Delayed recent results are released by the test after selecting an action instead of using a fixed delay.

The organize helper retains network idleness and also checks row geometry before coordinate-based actions. A recent-document storage entry was not a reliable readiness signal in warm CI, so removing the network-idle guard is deferred until a dedicated readiness signal is available. Assertion budgets remain unchanged. Reading-outline prerequisites also use the real API to avoid the composer's arrival refresh racing with anchor navigation.

These optimizations do not increase workers, reuse incompatible SSO build outputs, shorten assertion timeouts, or remove test coverage.

The reporting job installs only the four packages in `scripts/test/reporting/package-lock.json` rather than the application dependencies. Its Playwright version must match the main lockfile and discovery manifests; update both locks together when upgrading Playwright. Full discovery still runs in each application job, so simplifying the merger does not derive the expected test list from tests that happened to run.

Fixture setup resolves My Space with the real navigation API. The keyboard-row setup no longer reloads a document that `openKnowledge` just loaded; its existing interactive `armTree` checks still verify keyboard listeners before keyboard actions. Network-idle and geometry guards remain in `openKnowledge`.

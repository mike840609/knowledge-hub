# E2E CI sharding

CI runs the full Team-enabled suite in two independent jobs. Each shard owns its MariaDB service, isolated database, application builds, and server processes. Playwright retains `workers: 1` and `fullyParallel: false` because tests share workspace state inside each job.

Run a shard locally with the normal database prerequisites:

```sh
npm run test:e2e -- --shard=1/2 --reporter=list,blob
npm run test:e2e -- --shard=2/2 --reporter=list,blob
```

The runner passes the shard selection to discovery and execution, so only required application services are prepared. CI installs Chromium headless shell with `--only-shell`.

Each shard uploads `e2e-test-results-<index>` with traces, sanitized test/runner JSON, and Playwright blob results. The final `e2e` job preserves the original check name, verifies the union of recorded test IDs against full test discovery, rejects missing/duplicate/failed/flaky tests or incomplete runners, and merges the blob reports into HTML. Existing intentional skips remain visible in the counts; tests are not removed to shorten CI.

Compare browser time, runner stages, the slowest shard, and total CI runner usage over multiple runs before increasing the shard count. File-level sharding balances neither historical durations nor shared-state dependencies automatically. Keep empty-workspace tests before tests that populate the same user's workspace. Changes to test ordering must be checked in the complete shard, not just the edited spec.

Compiler caches are restored per platform, shard, dependency/configuration hash, and application/SSO fixture source hash. Main `.next/cache` and SSO `.cache/e2e-sso` are separate. Only compiler caches are persisted: each application is still built, and no `.next/BUILD_ID`, server bundle, or test database is reused. `KM_E2E_BUILD_CACHE=true` enables copying the SSO compiler cache into and out of its isolated temporary application. SSO temporary paths can limit cache reuse; compare cold and warm runs rather than assuming a fixed speedup.

Reading-link fixtures create documents through the API and explicitly navigate to the document under test. Document creation and rename UI coverage remains in the authoring tests and the rename scenario. Recent/favorite fixtures already create documents through the API; workspace lookup also uses the API, while reading and starring remain UI actions. Delayed recent results are released by the test after selecting an action instead of using a fixed delay.

The organize helper waits for the hydrated sidebar's persisted recent-document entry and stable row geometry rather than global network idleness. Assertion budgets remain unchanged.

These optimizations do not increase workers, reuse incompatible SSO build outputs, shorten assertion timeouts, or remove test coverage.

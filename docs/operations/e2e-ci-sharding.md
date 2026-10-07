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

This first phase does not increase workers, reuse incompatible SSO build outputs, shorten assertion timeouts, or remove test coverage.

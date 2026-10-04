# E2E Smoke and Coverage Inventory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide executable Team/Personal smoke suites, persist test and stage outcomes for every run, and inventory coverage case by case to inform subsequent case streamlining and isolation.

**Architecture:** Add Playwright tags to existing cases using PR #99's mode and service selection. A separate reporter generates test-result JSON, while the runner separately persists stage timings; use a unique artifact directory per run. Phase 1 does not change shared-data architecture or replace the full CI gate with smoke.

**Tech Stack:** Node.js 24.19.0, TypeScript, Next.js 15.5.25, existing Playwright/Vitest, MariaDB 10.11; no new packages.

**Spec:** `docs/superpowers/specs/2026-10-02-e2e-speed-design.md`(repository copy of the approved design)

## Global Constraints

- Preserve real-browser, identity, and authorization-boundary verification; do not skip required production builds.
- Do not hide failures with fixed sleeps, retries, weaker assertions, or longer timeouts.
- Retain existing `test:e2e` and the full CI gate; keep workers at 1.
- No tests cannot count as passed; count passed/failed/flaky/skipped separately.
- Reducing test count is not a goal; deletion candidates require concrete replacement coverage.
- Use the current isolated cloud checkout; do not create a new Git worktree.
- Do not persist process environment, credentials, full HTTP headers, or response bodies in artifacts.
- This plan delivers only phase 1 of the design. Phase 2 selects candidates from the coverage matrix, and phase 3 determines isolation interfaces from the shared-data inventory; write concrete separate plans for each. Vague follow-up tasks do not count as completion.

## Review Focus

1. Misspelled tag or no grep matches: discovery must fail rather than produce a green empty report. (Tasks 1, 2)
2. Personal `.env` leaking into Team smoke: Team/Personal use the runner's explicit modes. (Task 1)
3. Tests skipped because identity services did not start: smoke must finish with zero skipped and execute all tagged security cases. (Tasks 1, 2)
4. Build, test, or cleanup failure: still generate reports; successful writing must not overwrite the original failure. (Task 2)
5. Runs overwriting reports/CI losing successful results: unique run directory, artifact uploads use always. (Tasks 2, 3)

---

### Task 1: Stable Smoke Selection

**Files:**
- Modify: `package.json`, `tests/e2e/phase2.5-routing.spec.ts`, `tests/e2e/document-composer.spec.ts`, `tests/e2e/phase3-identity-harness.spec.ts`, `tests/e2e/share-link.spec.ts`, `tests/e2e/personal-workspace.spec.ts`, `README.md`
- Create: `tests/unit/e2e-smoke-selection.test.ts`

**Interfaces:**
- Consumes: Playwright test details `{ tag: string | string[] }`, existing `e2eTeamWorkspacesEnabled(environment)`, `requiredE2eServices(sources)`.
- Produces: `npm run test:e2e:smoke`, `npm run test:e2e:smoke:personal`; tags `@smoke-team`, `@smoke-personal`.
- Team script: `KM_E2E_SUITE=team-smoke tsx scripts/test/e2e.ts --grep @smoke-team`.
- Personal script: `KM_E2E_SUITE=personal-smoke KM_E2E_PERSONAL_ONLY=true tsx scripts/test/e2e.ts --grep @smoke-personal`.

- [ ] **Step 1: Add discovery regression tests.** Use a Node child process to invoke the existing Playwright CLI `test --list --reporter=json --grep <tag>`, disable all discovery server flags, and parse JSON suites/test tags. Read the actual catalog; do not mock selection.
  - Team selects exactly the 8 cases below; describe tagging must not pull in other cases from the same files.
  - Personal selects exactly root routing plus the 2 personal-workspace cases, totaling 3.
  - Nonexistent `@smoke-missing` must exit nonzero or be rejected by the runner's zero-case check.
  - All full-discovery test identities remain unchanged (record the catalog first, compare after adding tags).

Team tag list:
1. `phase2.5-routing.spec.ts`: `root resolves deterministically into My Space`(both tags).
2. `document-composer.spec.ts`: `the rendered editor mounts without hydration or page errors`.
3. `document-composer.spec.ts`: `typing Markdown syntax writes a heading and a list, and Create saves it`.
4. `document-composer.spec.ts`: `⌘Enter saves from inside the rendered editor`.
5. `phase3-identity-harness.spec.ts`: `ordinary production entry cannot enable a fixture reader with environment variables`.
6. `phase3-identity-harness.spec.ts`: `server persona controls Team creation; browser claims cannot elevate a noncreator`.
7. `phase3-identity-harness.spec.ts`: `real grant changes propagate between independent fixed server sessions`.
8. `share-link.spec.ts`: `owner shares, an anonymous reader follows the edits, and revoking ends it`.

Keep existing titles for the two Personal cases, add `@smoke-personal` to both, and preserve assertions.

- [ ] **Step 2: Run `npm run test:unit -- tests/unit/e2e-smoke-selection.test.ts`.** First confirm failure because tags do not yet exist.
- [ ] **Step 3: Add precise case tags, two npm scripts, and README documentation.** Do not change `test:e2e` to grep; use the runner's Personal mode without changing product `.env`.
- [ ] **Step 4: Rerun discovery regression tests.** Exact selection passes and full catalog stays unchanged; then run both smoke suites, executing 8/3 cases respectively with zero skipped.
- [ ] **Step 5: Commit.** `git add package.json README.md tests/e2e tests/unit/e2e-smoke-selection.test.ts && git commit -m "test(e2e): add Team and personal smoke selections"`.Stage only files changed by this task.

### Task 2: Persist Comparable Results

**Files:**
- Create: `scripts/test/e2e-report.ts`, `scripts/test/e2e-json-reporter.ts`, `tests/unit/e2e-report.test.ts`
- Modify: `scripts/test/e2e.ts`, `playwright.config.ts`

**Interfaces:**
- `E2eStage = { name: string; durationMs: number; status: "passed" | "failed" }`.
- `E2eCounts = { passed: number; failed: number; flaky: number; skipped: number }`.
- `E2eRunReport = { version: 1; runId: string; suite: string; mode: "Team-enabled" | "personal-only"; startedAt: string; durationMs: number; status: "passed" | "failed" | "cancelled"; stages: E2eStage[]; counts: E2eCounts | null; error: string | null }`.
- `writeE2eRunReport(directory: string, report: E2eRunReport): Promise<void>`: write `runner.json`; do not copy process.env.
- Reporter uses Playwright `Reporter.onEnd` and suite catalog to write `tests.json`, persisting only file/title/status/duration/retry and counts; do not serialize config, environment, attachment bodies, or stdout/stderr.
- At each start, Runner creates `playwright-report/e2e-runs/<suite>/<UUID>/` and passes it to the reporter through `KM_E2E_RUN_REPORT_DIR`. `playwright-report/` is already ignored; do not store runner reports in `test-results/`, which Playwright clears on startup.
- Unset `KM_E2E_SUITE` defaults to `full`; Personal mode without a smoke command uses `personal`; restrict suite labels to safe characters and forbid directory traversal.

- [ ] **Step 1: Add report tests.** Perform real writes in a tmp directory and read JSON back; verify separate outcome counts, duration in ms, no overwriting between two UUID runs, and no environment field.
  - Simulate build failure: counts=null, failed stage, error present.
  - Simulate browser failure and successful cleanup: remain failed.
  - Simulate original failure plus cleanup failure: retain both; cleanup success/failure cannot overwrite the original result.
  - Simulate cancellation: still write a cancelled report.
  - Zero tests or skipped smoke: cannot mark passed.
  - Use reporter callbacks from a real Playwright fixture run to verify JSON counts and exit status; keep fixtures in tmp so the formal E2E catalog does not collect them.
- [ ] **Step 2: Run `npm run test:unit -- tests/unit/e2e-report.test.ts`, confirming failure before implementing the new interface.**
- [ ] **Step 3: Implement reporter, report writer, and runner integration.** Append stage data to existing segmented `timed`; write reports in finally after cleanup, retaining original error and nonzero exit. Config retains list reporter for normal runs and adds the new reporter; discovery JSON reporter stays explicitly selected by existing CLI, without mixed text output.
- [ ] **Step 4: Rerun tests and smoke.** Runner reports agree with reporter counts; failing fixtures still exit nonzero; successful smoke has zero skipped. Reports list the current artifact path, and files stay out of Git.
- [ ] **Step 5: Commit.** `git add scripts/test/e2e.ts scripts/test/e2e-report.ts scripts/test/e2e-json-reporter.ts playwright.config.ts tests/unit/e2e-report.test.ts && git commit -m "test(e2e): persist run timings and outcomes"`.

### Task 3: Reviewable Coverage Matrix and CI Artifacts

**Files:**
- Create: `docs/superpowers/verification/2026-10-02-e2e-coverage-matrix.md`
- Modify: `.github/workflows/phase2-dev-gate.yml`, `README.md`

**Interfaces:**
- Each row: E2E file/exact case title, tested behavior, unit/integration file/case, browser-specific assertions, decision (retain/layer-move candidate/setup acceleration only), defects that would fail replacement tests, required additional tests.
- CI retains full `npm run test:e2e`; only change artifact uploads to `if: always()`, including `test-results/` and `playwright-report/e2e-runs/`; absence of results must not pretend to pass.

- [ ] **Step 1: Read initial candidates case by case.** Compare title/save/Markdown conversion cases in `document-composer.spec.ts` against `authored-title.test.ts`, `composer-output.test.ts`, and `markdown-editor.test.ts`; compare `zz-organize.spec.ts` against `organize-api.test.ts` and `organize-messages.test.ts`. Cases with UI assertions cannot be classified as pure duplication.
- [ ] **Step 2: Write the matrix.** Every proposed deletion requires exact replacement assertions; if none qualifies, record “No cases in this batch can be directly deleted,” without forcing reductions. At minimum distinguish H1/frontmatter, nonempty folder archival, archive Undo, and rename/move refusals.
- [ ] **Step 3: Update CI artifact uploads and README.** Confirm CI still runs the full gate; upload success does not mean test success.
- [ ] **Step 4: Run `npm run test:unit && npm run typecheck && npm run lint`, and inspect diff.** The matrix inventories evidence, without E2E deletion; script-only changes do not affect package-lock.
- [ ] **Step 5: Commit.** `git add docs/superpowers/verification/2026-10-02-e2e-coverage-matrix.md .github/workflows/phase2-dev-gate.yml README.md && git commit -m "docs(e2e): map coverage and retain CI run artifacts"`.

### Task 4: Complete Verification, Performance Comparison, and Next-Phase Interfaces

**Files:**
- Create: `docs/superpowers/verification/2026-10-02-e2e-smoke.md`

**Interfaces:**
- Consume Tasks 1–3 commands/artifacts, producing traceable measurements and concrete next-phase candidates.

- [ ] **Step 1: Obtain the current full baseline.** Historical 454.82 seconds is reference only; run full mode once, retaining stage/results JSON. Record current SHA, Node/Playwright, CPU, cold/warm build; do not run another build concurrently that overwrites `.next`.
- [ ] **Step 2: Sequentially run `npm run test:e2e:smoke` and `npm run test:e2e:smoke:personal`.** Run each twice, retain individual timings, and do not assume a speedup percentage.
- [ ] **Step 3: Check outcomes.** Full should retain the current set and existing mode skips; Team smoke 8, Personal smoke 3, all zero failed/flaky/skipped. Added tests follow current catalog identities; compare more than total count.
- [ ] **Step 4: Write verification records and request independent review.** Answer how much daily smoke saves, whether build dominates smoke, which specs take longest, and which merit API setup. A slow report does not justify deletion.
- [ ] **Step 5: Write next-phase input lists.** Use the coverage matrix to select cases for API setup; use concrete references to shared My Space/graph/fixed identity to choose spec isolation or independent job shards. Write separate phase 2/3 implementation plans; do not raise workers in this phase.
- [ ] **Step 6: Commit verification records.** `git add docs/superpowers/verification/2026-10-02-e2e-smoke.md && git commit -m "docs(e2e): record smoke and full regression measurements"`.

## Self-review

This plan covers phase 1 of the approved design; layer moves, API setup, data isolation, and parallelism remain follow-up plans based on inventory findings and do not count as delivered. No UI-behavior cases are preemptively deleted, and the full CI gate is preserved. Smoke selection is exact, result formats/directories are explicit, and all five Review Focus items have corresponding tests and verification.

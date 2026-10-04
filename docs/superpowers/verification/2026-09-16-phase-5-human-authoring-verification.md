# Phase 5 Human Authoring — Verification

**English** | [繁體中文](2026-09-16-phase-5-human-authoring-verification.zh-TW.md)

| Item | Details |
| --- | --- |
| Date | 2026-09-17 |
| Spec | `docs/superpowers/specs/2026-09-16-phase-5-human-authoring-design.md` |
| Plan | `docs/superpowers/plans/2026-09-16-phase-5-human-authoring.md` |
| Branch tested | `feat/phase-5-human-authoring`, worktree `km-wt-1`, HEAD `bcfe9610fb8e99eeba9b3a9413aa4c9ccc0b0bc2` |
| Environment | macOS 26.6.2, Node v24.6.0, npm 11.5.1, Playwright 1.63.0 (Chromium installed), MariaDB 10.11.19 (Docker `hcm-km-phase0-mariadb-1`, image `mariadb:10.11`) |

All six gates were rerun at **the same HEAD** (`bcfe961`), rather than reusing numbers from earlier task reports. Raw output is in
`.superpowers/sdd/2026-09-16-phase-5-human-authoring/task-10-report.md`。

Environment noise: bare `npm` in this shell is shadowed by an nvm shell function, returning
`command not found: _nvm_load` in a noninteractive environment, so all commands used the absolute path
`/Users/chuntsai/.nvm/versions/node/v24.6.0/bin/npm`. Each command wrote its results directly to its own log and immediately read
`$?`, without any pipeline that could swallow the exit code.

## Commands and results

| Command | Result |
| --- | --- |
| `npm run test:unit` | PASS — 36 files / **256 tests**, exit 0, Duration 1.58s |
| `npm run typecheck` | PASS — exit 0, no output (`tsc --noEmit` with zero errors) |
| `npm run lint` | PASS — exit 0, `eslint .` with zero errors and warnings |
| `npm run build` | PASS — exit 0, `next build` successfully produced 32 routes without warnings |
| `make db-up` | MariaDB container Healthy |
| `npm run test:integration` | PASS — 38 files / **376 tests**, exit 0, Duration 42.03s |
| `npm run test:e2e` (complete, unfiltered) | PASS — **46 passed / 0 failed**, exit 0, 29.0s |

Before execution, confirmed that `scripts/test/e2e.ts` invokes Playwright using `node_modules/@playwright/test/cli.js test ...process.argv.slice(2)`;
`npm run test:e2e` had no additional arguments, so the 46 cases above are
 the complete `tests/e2e/*.spec.ts` suite, with no filtering or skips.

**Comparison with expected numbers**: unit 256/256, integration 376/376, e2e 46/46, and typecheck/lint/build all exit 0 —
the measured numbers for all six gates match expectations exactly, with no discrepancy requiring investigation.

## Requirement mapping

### Unit tests (U1–U5, no DB required)

| # | Requirement source | Test file | Cases | Result |
| --- | --- | --- | --- | --- |
| U1 | §8.1 | `tests/unit/phase5-can-write.test.ts` | `canWrite derivation (spec §8.1)` › `is true for roles holding document.write`、`is false for VIEWER` | PASS |
| U2 | §6.1、§6.2 | `tests/unit/phase5-authoring-input.test.ts` | `rejects giving both title and filename`、`rejects giving neither`、`rejects a non-object body and non-string fields`；`parseUpdateDocumentInput` › `requires all three fields` | PASS |
| U3 | §6.2 | `tests/unit/phase5-authoring-input.test.ts` | `resolves the title from frontmatter when a filename is given`、`falls back to the first H1, then to the filename stem` | PASS |
| U4 | §7.2 | `tests/unit/phase5-error-mapping.test.ts` | `maps a stale-editor conflict to 409, never 500`, `maps a write against SOURCE_MANAGED content to 409`, `maps archived source and document to 409`, `maps candidate validation failures to 400`, `maps missing document and source to a non-enumerating 404` | PASS (**gap** below) |
| U5 | §6.4 | `tests/unit/phase5-authoring-input.test.ts` | `rejects an over-long title and an over-large markdown body` | PASS |

### Integration tests (I1–I10, DB required)

| # | Requirement source | Test file | Cases | Result |
| --- | --- | --- | --- | --- |
| I1 | §5.1 | `tests/integration/phase5-default-hub-source.test.ts` | `creates a Notes source on first use` | PASS |
| I2 | §5.3 | `tests/integration/phase5-default-hub-source.test.ts` | `is idempotent: a second call reuses the same source`、`creates exactly one source under concurrent first writes` | PASS |
| I3 | §4 | `tests/integration/phase5-authoring-service.test.ts` | `creates revision 1 in the lazily provisioned source`、`creates revision 2 on edit and leaves revision 1 untouched` | PASS |
| I4 | §4 | `tests/integration/phase5-authoring-service.test.ts` | `does not create a revision when the content is unchanged` | PASS |
| I5 | §4 | `tests/integration/phase5-authoring-service.test.ts` | `rejects a stale editor and keeps the winner's content` | PASS |
| I6 | §7.1 | `tests/integration/phase5-authoring-service.test.ts` | `refuses a VIEWER on both create and edit` | PASS |
| I7 | §4 | `tests/integration/phase5-authoring-service.test.ts` | `refuses edits to SOURCE_MANAGED content` | PASS |
| I8 | §6.3 | `tests/integration/phase5-authoring-service.test.ts` | `preserves existing metadata across an edit` | PASS |
| I9 | §5.4 | No independent integration case—see “Known intentional deviations” below | — | Covered by the shared path in I1–I8 |
| I10 | §6.2 | Moved to the unit layer—see “Known intentional deviations” below, corresponding to U3 | — | Covered by U3 |

`tests/integration/phase5-default-hub-source.test.ts` also has `refuses a caller without document.write`
(the fourth of 4 tests), corresponding to I6 (§7.1 VIEWER refusal) at the provisioning layer; it is not a numbered item in spec §9.2,
but belongs to the same §7.1 requirement.

### E2E（E1–E4）

| # | Test | Actual case (`tests/e2e/phase5-authoring.spec.ts`) | Result |
| --- | --- | --- | --- |
| E1 | Create new document → appears in Tree → correct content | `creates the first document in a workspace with no sources` | PASS |
| E2 | Edit existing HUB_MANAGED document → history shows two revisions | `edits a hub-managed document and records a second revision` | PASS |
| E3 | SOURCE_MANAGED document has no Edit and shows Read only | `never shows Edit on source-managed content` | PASS |
| E4 | Upload `.md` → title comes from frontmatter | `uploads a markdown file and takes its title from frontmatter` | PASS |

### Fixture（§9.4）

The E2E-required “Workspace with no Hub Source at all” is created in an independent `unitOfWork.run` block in `seedBrowserFixtures`,
after the existing empty-table check for a fresh database (learning from Phase 4's verification record); all-green `test:e2e` means this
fixture ordering worked correctly in this run, without reproducing Phase 4's fixture-ordering bug.

### Acceptance criteria (§10)

| Criterion | Mapping | Status |
| --- | --- | --- |
| Create and edit both produce immutable Revisions; unchanged content produces no new revision | I3, I4 | PASS |
| Two people editing simultaneously: the later submission receives 409 and does not overwrite the other person's content | I5 | PASS |
| VIEWER and SOURCE_MANAGED writes are always refused, with no UI entry point | I6, I7, E3 | PASS |
| Existing metadata is not lost through editing | I8 | PASS |
| Single-document upload title resolution matches folder import | I10 (U3), E4 | PASS |
| All §9 test cases pass | All cases above | PASS |
| `make verify`, `npm run test:integration`, and `npm run test:e2e` all green | See “Commands and results” | PASS (this record reruns `test:unit` / `typecheck` / `lint` / `build` independently in place of `make verify`, with equivalent results) |

## Known intentional deviations

- **No unit tests for Authoring UI components**: `document-editor.tsx`, `new-document-form.tsx`, and
  header/page changes have no component-level unit tests. `vitest.config.ts` sets
  `environment: "node"`; this repo has no jsdom, and the spec's Global Constraints prohibit new dependencies, so component rendering
  cannot be tested at the unit layer. Behavior is covered by `tests/e2e/phase5-authoring.spec.ts` instead.
- **Documents with empty markdown content may be created**: creation with only a title submits `{ title, markdown: "" }`; this is intentionally
  allowed behavior rather than a defect.
- **Two existing E2E specs updated for deliberate Phase 5 behavior changes**:
  - `phase2.5-knowledge-explorer.spec.ts` previously expected the “Read only” badge always; commit `d88f95d` changes it to
    depend on ownership (previously it appeared incorrectly even for editable documents; this change makes it truthful).
  - `phase3-workspace-governance.spec.ts` previously expected no file input in the empty state; commit `318f177` deliberately adds
    an upload control.
  Both were confirmed to be outdated presentation expectations rather than authorization-boundary regressions; governance-suite assertions that actually check authorization boundaries were not
  changed.
- **I9 (My Space can create and edit) has no independent integration case**: `assertPersonalMutationAllowed`
  (`src/modules/workspaces/application/personal-workspace-service.ts:38`) directly
  returns for `content-write`, following exactly the same path as a Team workspace; existing cases in `tests/integration/phase5-authoring-service.test.ts`
  cover that shared path.
- **I10 (three title sources for single-document upload) is at the unit rather than integration layer**: title resolution
  (`resolveImportTitle`) is a pure function; hitting the DB adds no coverage, so it is in
  `tests/unit/phase5-authoring-input.test.ts` (corresponding to U3). E2E also has one frontmatter case
  (`uploads a markdown file and takes its title from frontmatter` in `tests/e2e/phase5-authoring.spec.ts`).

## Known gaps (nonblocking, still recorded)

- `tests/unit/phase5-error-mapping.test.ts` does not explicitly name `InvalidMetadataError` in a 400 assertion; currently coverage relies on
  `INVALID_TITLE` and `INVALID_METADATA` sharing the same status-code list (`src/server/http-error-response.ts`)
  indirectly, without a dedicated case locking it down.
- The doc comment in `src/server/http-error-response.ts` references outdated line numbers for the two not-found lists.
- `src/modules/sources/application/ensure-default-hub-source.ts` uses
  `listByWorkspaceId` to scan the entire table and filter in memory—if a Workspace accumulates many Sources, each authoring call is
  O(n); this matches the spec's “no migration” position and is not a newly introduced defect.
- The 400 case in `tests/unit/phase5-update-route.test.ts` asserts only the status code, unlike the corresponding
  `tests/unit/phase5-create-route.test.ts` case, which also asserts `body.error.code`.
- `src/app/api/documents/[documentId]/route.ts` has no inline comment explaining why `canonicalizeJsonObject` wraps stored metadata
  (confirmed to be type narrowing and a provably idempotent no-op, rather than a logic defect).
- `DocumentHeader`'s `editHref` is required, without a default value.
- `new-document-form.tsx`: `busy` is set inside `create()` only after `await file.text()`; theoretically,
  quickly reselecting a second file during that await could trigger concurrent creation calls; Cancel clears only `open`, not `title`; the button says
  “Upload .md,” but `accept` permits both `.md` and `.markdown`.
- Test output continues to show one existing warning unrelated to this branch: `The CJS build of Vite's Node API is deprecated`.

## Changed files

Changes at the time this acceptance record was produced:

- `docs/superpowers/verification/2026-09-16-phase-5-human-authoring-verification.md`: this acceptance record (new).
- `.superpowers/sdd/2026-09-16-phase-5-human-authoring/task-10-report.md`: raw output of the six gates (new task artifact, not the acceptance record itself).

No source code, tests, or spec files were changed.

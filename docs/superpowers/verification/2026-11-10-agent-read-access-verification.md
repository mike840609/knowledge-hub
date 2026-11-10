# Agent read access — verification (2026-11-10)

Evidence from local runs on branch `claude/lucid-goldberg-koh6ys`, macOS, Node v24.6.0.
[Design](../specs/2026-11-10-agent-read-access-design.md) · [Plan](../plans/2026-11-10-agent-read-access.md).
No CI result is claimed here; CI had not run on this branch when this was written.

## Gate

`make verify` did not run on this machine: `pnpm` resolved to a corepack shim whose target was missing (`.../corepack/v1/pnpm/12.16.1/bin/pnpm.cjs`, `MODULE_NOT_FOUND`), so `make test-unit` stopped before running a test. Its four parts were run by hand instead:

| Check | Command | Result |
|---|---|---|
| Unit | `vitest run --config vitest.config.ts` | exit 0; 386 files, 4679 tests passed |
| Typecheck | `node node_modules/typescript/bin/tsc --noEmit` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Build | `npm run build` | exit 0; all routes compiled, including `/api/agent/search`, `/api/agent/documents` and `/api/agent/tasks` |

The full integration suite was run with no file arguments, MariaDB up on 127.0.0.1:3307:
`tsx scripts/test/integration.ts` — exit 0; 121 files passed, 1 skipped; 1238 tests passed, 1 skipped.
`make test-integration` would also have gone through the broken pnpm, so `docker compose up -d --wait mariadb` was run directly (healthy) and the suite command above was run by hand.

## Real run

**Which server.** `make dev` would also have gone through pnpm, so `npm run dev` was run directly. An older dev server already held `127.0.0.1:3000`; the process under test (this tree) therefore served `127.0.0.1:3001`. A second process under test with `TASK_SEARCH_READ_ENABLED=true` served `127.0.0.1:3002` for the task-search case. Both were stopped at the end; the older server on port 3000 was left alone.

**How the binding was made.** On the setup page in a headless Playwright browser: the page was opened at `/w/<workspaceId>/tasks/setup`, the label `agent-read-t6-3001` was typed, and `Create binding` was clicked. The page then showed the new sentence:

> The token can read every document and task result in your My Space, and add task results; it cannot change a document.

A first attempt labelled `agent-read-t6` was made against the older server on port 3000 before that port was noticed; it was not used for any command below. Both bindings were revoked after the run. The binding used for every command was `01a1c338-4871-7e29-bc6c-577b28b2ac02`.

**Temporary configuration.** `knowledge-hub configure` used a temporary `HOME` (`/tmp/kh-t6-home`, removed afterwards), so the owner's existing CLI configuration and credentials were not overwritten. The setup line's token is written as `<token>` below and appears in no committed file.

| # | Command | Exit | Output (abridged) |
|---|---|---|---|
| 1 | `knowledge-hub configure --hub-url http://127.0.0.1:3001 --binding-id 01a1c338-4871-7e29-bc6c-577b28b2ac02 --token <token> --allow-insecure-localhost` | 0 | `Configured to export with binding 01a1c338-4871-7e29-bc6c-577b28b2ac02, from every project on this machine.` (the token was not printed) |
| 2 | `knowledge-hub status` | 0 | `Configured: binding 01a1c338-4871-7e29-bc6c-577b28b2ac02 at http://127.0.0.1:3001.` |
| 3 | `knowledge-hub search onboarding` | 0 | 20 document hits, first: `01a1916e-ccb7-7bf5-82a3-477fff8fa0e7  ui-comparisons/mvp-onboarding/README.md  MVP first-use onboarding`; ended `More results exist. Narrow the search.` |
| 4 | `knowledge-hub read handbook/onboarding.md` | 0 | 1085 bytes of Markdown; header `# Knowledge context`, then `Provenance: {"title":"新人報到","source":"範例知識庫","path":"handbook/onboarding.md","documentId":"01a11efa-836d-7f40-880c-92a50cb09b97",...}` |
| 5 | `knowledge-hub read 01a11efa-836d-7f40-880c-92a50cb09b97` | 0 | Byte-identical to #4 (`cmp` exit 0) |
| 6 | `knowledge-hub export --new` (piped JSON, a new Task Result) | 0 | `Saved to Knowledge Hub: http://127.0.0.1:3001/w/<workspaceId>/tasks/01a1c338-c657-7c90-9709-33bc7f70a037`; `Task ID: 539afc48-6fb0-4b13-ae7f-1134b85f3013` |
| 7 | `knowledge-hub search --tasks "Agent read access"` (server on 3001, flag off) | 3 | `Knowledge Hub answered 503.` (no rows) |
| 8 | `knowledge-hub configure --profile tasks-on --hub-url http://127.0.0.1:3002 --binding-id 01a1c338-4871-7e29-bc6c-577b28b2ac02 --token <token> --allow-insecure-localhost` | 0 | `Configured profile tasks-on to export with binding 01a1c338-4871-7e29-bc6c-577b28b2ac02, from every project on this machine.` |
| 9 | `knowledge-hub search --tasks "Agent read access" --profile tasks-on` (server on 3002, flag on) | 0 | `01a1c338-c657-7c90-9709-33bc7f70a037  -  Agent read access verification run`, with an indented snippet |
| 10 | `knowledge-hub read --task 01a1c338-c657-7c90-9709-33bc7f70a037 --profile tasks-on` | 0 | JSON: `taskResultId`, `revisionNo: 1`, the content with `completedAt`, and `references` with the WIKI path `handbook/onboarding.md` in state `RESOLVED` |

The setup page was also fetched with `curl` on the older server on port 3000 (HTTP 200) before that port was noticed; the browser step on port 3001 is the one that created the binding.

## What did not behave as the plan says

- `make verify` and `make test-integration` cannot run here because of the broken pnpm/corepack shim; the equivalent commands and their exit codes are listed above.
- `search --tasks` with `TASK_SEARCH_READ_ENABLED` off exits 3 as the spec requires, but the CLI prints only `Knowledge Hub answered 503.`; it does not say that task search is disabled. The setup guide's exit-3 row names the condition, not the CLI output.
- The known 409 hint that omits `--profile` did not arise: no ambiguous path was exercised in this run.
- The setup page on the older server on port 3000 did not show the new sentence; it was serving code from before this task. The process under test on port 3001 did show it (quoted above).

## Follow-up verification (2026-11-10)

The real run above was made before `e682e7cd`. Since that record, `e682e7cd` and the follow-up commit changed every open behaviour it lists:

- `kind=tasks` with the flag off still answers 503, but the route now carries a message and the CLI prints it: `TASK_SEARCH_UNAVAILABLE` and `Task search is not enabled on this Hub.`
- The 409 ambiguous-path hint now carries `--profile` (or its base64url form) for the selected profile.
- `HEAD` and `OPTIONS` on all three agent routes now answer 405 with `Allow: GET` and `Cache-Control: private, no-store`, instead of Next's own answers.
- `read` strips C0 and C1 control characters (except tab, newline and carriage return) from the Markdown it prints.
- `status` honours `--profile-b64`.

The final verification in this follow-up run, all on this worktree with Node v24.6.0:

| Check | Command | Result |
|---|---|---|
| Unit | `vitest run --config vitest.config.ts` | exit 0; 386 files, 4,692 tests passed |
| Typecheck | `node node_modules/typescript/bin/tsc --noEmit` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Integration | `tsx scripts/test/integration.ts` | exit 0; 121 files passed, 1 skipped; 1,239 tests passed, 1 skipped |

Two earlier full-unit attempts ran while other worktrees on the same machine were running vitest (load average above 45). They failed only in unrelated UI files, all from 5-second timeouts or their cascades, and every failed file passed when rerun alone; the full-unit line above is a clean run.

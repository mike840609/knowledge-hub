# Task knowledge export — verification (2026-11-04)

Evidence from local runs on branch `feat/task-knowledge-export`, macOS, Node v24.6.0.
[Design](../specs/2026-11-04-task-knowledge-export-design.md) · [Plan](../plans/2026-11-04-task-knowledge-export.md).
No CI result is claimed here; CI had not run on this branch when this was written.

## Gate (run in sequence, no overlapping runs)

| Check | Command | Result |
|---|---|---|
| Unit | `vitest run --config vitest.config.ts` | 360 files, 4402 tests passed |
| Typecheck | `tsc --noEmit -p .` | exit 0 |
| Lint | `eslint .` | exit 0 |
| Build | `node scripts/build.mjs` | exit 0 |
| Integration | `tsx scripts/test/integration.ts` | 111 files, 1119 tests passed |
| E2E | `tsx scripts/test/e2e.ts tests/e2e/task-export-flow.spec.ts tests/e2e/task-export-my-space.spec.ts` | 3 passed |

An earlier full run of the same gate failed two tests, both caused by this branch and fixed before the run above:
`share-link-single-exception` (its revision-repository guard matched a `detail.revisions.map(` in the new task pages; the field is now `revisionHistory`) and `task-export-storage` (the document lookup gained `title`).

## End-to-end flow (`tests/e2e/task-export-flow.spec.ts`)

Against the built server, with the real CLI as a child process and a delaying proxy in front of the server:

- The browser creates a binding; `knowledge-hub configure --allow-insecure-localhost` reads the token from stdin.
- `export --new` through the proxy: the server commits, the proxy holds the answer past `KNOWLEDGE_HUB_TIMEOUT_MS=1500`; the CLI exits 3 with "may already be stored". A second `--new` exits 2 and names `export --retry <taskId>`; `--retry` exits 0. My Space lists exactly one task, with a link to the Wiki page by its live title.
- `export --task` adds revision 2. Archive: `--task` exits 4 naming restore; after restore, `--retry` exits 0.
- Rotation on the setup page: the next export exits 4 naming `configure --rotate <bindingId>`; after it, `--retry` exits 0.
- Revocation: the next export exits 4; the task stays readable and shows "Binding revoked".
- A browser session posting to the ingest route without the export header: 401. A binding request for an unknown Workspace: 404; `/w/<random>/tasks`: 404.
- A real `OPTIONS` to `/api/task-results/ingest` through the middleware: 405, `Allow: POST`, `Cache-Control: private, no-store`, no `Access-Control-Allow-*` header.

An archived or missing Source answering 403 is covered by `tests/integration/task-export-http.test.ts`, not by this E2E.

## My Space UI (`tests/e2e/task-export-my-space.spec.ts`)

Discoverable from the Home actions menu with no sidebar entry; HTML, Markdown, `javascript:` and `data:` content renders as text, no `href` carries an unsafe scheme, the injected handler never runs; Unicode titles render; revision switch; archive/restore; no horizontal scroll at 390px; unknown task → 404.

## Agent tools: verification gap

Installed locally: Claude Code 2.1.316 and OpenCode v2.1.4 (whose user commands directory, `~/.config/opencode/commands/`, exists). The manual check that `/hub-export` is discovered and runs in each tool, in a project other than the Hub repo, was **not run**: it installs into the user's real `~/.claude` and `~/.config/opencode`. `tests/unit/task-export-agent-instructions.test.ts` covers the installer into a temporary home. Run `knowledge-hub install-agent` and `/hub-export` in each tool to close this gap.

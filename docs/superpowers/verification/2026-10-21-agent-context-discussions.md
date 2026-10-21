# Copy for Agent discussion context verification

## Behavior

Copy for Agent keeps one action and always appends visible OPEN and RESOLVED discussions, with replies, to each selected saved document. The preview reports document, discussion and comment counts. Hidden threads and fully retracted threads are omitted; hidden/deleted comments use placeholders. Outdated discussions retain comments but never export stale anchor quotes. Both document and discussion content count toward the existing 256 KiB UTF-8 limit.

The export uses the existing personal-workspace authorization and transaction boundary. Anchor relocation uses the same revision as the exported body. READ COMMITTED reads do not promise immutable or transaction-wide discussion history.

## Evidence

- Regression-first run: four new service cases and the preview count assertion failed against the old implementation because discussions were absent.
- `npm run test:unit`: 238 files, 3,011 tests passed on the final implementation. An earlier run caught a test assertion matching the label `Passage:` instead of the stale quoted content; corrected to test the quoted content and reran the suite.
- `npm run test:integration`: 82 files, 747 tests passed, including a real persisted discussion, reply and resolution exported alongside imported documents, with mixed-workspace and archived selections still rejected.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run test:e2e -- tests/e2e/mvp-discovery-agent.spec.ts`: production build passed; 1 browser test passed. It creates OPEN and RESOLVED threads and replies, regenerates the preview, checks counts, reads the actual clipboard and compares it with the preview, then exercises clipboard denial and selection invalidation.
- Unit coverage includes multi-document association, chronological replies and attribution, suppressed bodies, wholly retracted threads, outdated/moved anchors, zero discussions and overflow caused by discussion content.

Scope: the targeted browser flow was run; the full browser suite was not run. No schema migration is needed.

## Addendum (2026-10-22): review hardening

Changes verified: comment bodies are JSON string fields with a separate `state`; every JSON record line (`Provenance:`, `Thread:`, `Passage:`, `Comment:`) escapes U+0085, U+2028 and U+2029 as `\uXXXX`; `AgentContextFormatter` encodes each segment once; comments load in batches of 100 threads with the byte bound checked between batches; hidden threads are skipped before loading and author lookup is skipped for retracted threads; the unused `formatAgentContext` was removed.

Run locally (Node 24.6.0) for these follow-up commits:

- `vitest` on `agent-context-discussions`, `mvp-agent-context`, `mvp-agent-context-builder`: 3 files, 17 tests passed. The new hostile-separator test fails when the escaping is removed.
- `tsc --noEmit`: exit 0. `eslint .`: exit 0.
- Full unit suite: 238 files, 3018 tests passed.
- Integration suite (`scripts/test/integration.ts`, isolated DB on the running MariaDB at 127.0.0.1:3307): 82 files, 748 tests passed, including the extended `listByThreads` case (three threads, ordering per thread, unrequested thread excluded).

The Playwright e2e spec (`tests/e2e/mvp-discovery-agent.spec.ts`) was NOT run for these follow-up commits; CI will run it. It asserts only substrings (`OPEN discussion retained`, `RESOLVED reply retained`, counts), which still occur inside the JSON body, but that is an inference from reading the spec, not a run.

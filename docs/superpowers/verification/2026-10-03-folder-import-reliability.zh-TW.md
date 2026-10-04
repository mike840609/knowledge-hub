# Folder import reliability verification — 2026-10-03

[English](2026-10-03-folder-import-reliability.md) | **繁體中文**

本文件記錄資料夾匯入可靠性的修正、測試結果與限制。 以下保留原始英文歷史證據全文，以維持測試輸出、數字、命令與路徑的可追溯性；本頁並非逐段中文翻譯。

## Initial branch split (historical)

- PR #98: `fix/folder-import-access-refresh` restored exactly to `c3cc2156e1f5a347709d02920d1709fe6aff4fe8`; no changes to that commit's tree.
- Original follow-up chain: all 35 commits from `6c8bf5d` through `7092c74f1f0c0d51abb138ab2740c4bf2a0ac0d2` preserved on `fix/folder-import-reliability-hardening`, descending directly from `c3cc2156`.
- The previously rewritten remote head `73c03a4135096231ec25c9ff5128a20ebfb6da27` was saved to `backup/folder-import-access-refresh-before-split-20261003` before the lease-protected ref restoration.
- Local work ran in an isolated worktree. Existing changes in the primary checkout were not modified.
- Review base is `fix/folder-import-access-refresh`. The workflow now includes that stacked base in its pull-request triggers. Neither PR is merged. Existing PR #102 overlaps the core follow-up; it was not modified.

## TDD and behavior

The inherited 15 related unit cases passed on the recovered follow-up head. Added behavioral tests first reproduced four failures: pre-cancelled creation, cancellation during the last asset read, failure to retry a truncated successful finalize body, and hash workers remaining active after a file-read failure. Two additional rendered tests first failed for explicit Cancel import and pagehide. All six failures were fixed; the full unit suite passed afterward.

Coverage also verifies custom asset total/per-file preflight, default and configured runtime limits, bounded retry exhaustion, cancellation without reusing an aborted signal for cleanup, creator-only deletion, cascading staging entries, immediate quota release, cleanup after membership revoke, and preservation of READY/APPLIED snapshots.

The browser lost-response test commits the original fixture bytes with the browser's actual upload keys, aborts the first upload response, then checks the real browser replay returns `accepted: 0` with every Markdown entry idempotent. It also truncates the first successful finalize response and verifies the same snapshot reaches its preview after replay. Only one create request is sent.

## Initial local checks (historical)

Environment: Node v24.6.0, MariaDB 10.11. Integration and E2E runners provision and dispose isolated test databases.

| Check | Result |
| --- | --- |
| `npm run test:unit` | PASS — 104 files, 1,492 tests |
| `npm run test:integration` | PASS — 53 files, 617 tests |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run build` | PASS |
| `npm run test:e2e` | PASS — 223 passed, 2 existing personal-rollout cases conditionally skipped; 6.1 minutes |
| `git diff --check` | PASS |
| Workflow YAML parse and stacked-base trigger | PASS |

The first E2E run exposed an inherited quota test expecting 409 rather than the existing 400 + `IMPORT_BUILDING_QUOTA_EXCEEDED` contract. Its failed assertion stranded snapshots and blocked later import cases; it now cleans up in `finally`. A Details inspector case passed on the subsequent full run without a source change.

The next run exposed Playwright's disk-backed multipart forwarding omitting file bytes; the fault-injection test now sends the original bytes before dropping the response. The affected lost-response/cancel/asset scenarios passed in the focused run. That run also exposed a source-name collision in an existing fuzzy “Import folder” link locator; it now uses exact matching. Final verification used a fresh full run after those test corrections: all 9 source-import cases and the entire enabled suite passed, without retries.

## Limits of recovery

Upload/finalize receive one automatic replay; non-idempotent creation is not replayed. Abandon is best effort: offline or unknown-id creation failures retain the existing two-hour BUILDING TTL fallback. This change does not add persistence/resume across browser restarts or wire a cleanup scheduler.

## Integration after #98 and #101

After #98 merged, #103 was retargeted to main and integrated main at `5356da1`. Native directory picking now uses the same abort signal, runtime asset limits and cleanup flow as the fallback picker. Remembered-folder Sync now receives server runtime limits, cancels on pagehide/unmount, and separates Strict Mode lifecycle from permission state.

Two new remembered-folder regression cases failed before implementation: the first Strict Mode click and pagehide cancellation. Coverage also checks forwarding custom limits, rejecting oversized native-picker assets before reads/session creation, and cancelling native folder collection before snapshot creation or handle persistence. Unit verification passed 1,585 tests; lint and typecheck passed. The full integration/E2E suites and GitHub CI are rerun for this merged tree before PR integration.

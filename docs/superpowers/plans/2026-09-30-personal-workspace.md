# Personal workspace delivery

**English** | [繁體中文](2026-09-30-personal-workspace.zh-TW.md)

- [x] Team rollout gate: trusted caller scope, authorization and navigation; disabled Coming soon entries; off/on boundary tests.
- [x] Persistent drafts: durable account-scoped storage and recovery UI, explicit save status/failures; browser recovery and conflict tests.
- [x] Document organization: reuse the remote mainline's Knowledge tree controls and authorized routes; Home links to the tree. Existing ownership, placement and archive/restore tests cover this batch.
- [x] Markdown export: canonical serializer and authenticated single/bulk downloads; path, metadata and authorization tests.
- [x] Revision restoration: optimistic new-revision operation and history UI; immutable-history/conflict tests.
- [x] Personal home and favorites: persistent account data, recent/draft/favorite entry points and navigation; account isolation and browser persistence tests.
- [x] Run unit/typecheck/lint/build and relevant integration/browser flows. Record actual results and limitations, update canonical docs.

Implementation is authorized; proceed in order without approval checkpoints. No deployment or merge requested.

Completed in the isolated `codex/personal-workspace` branch, rebased on `origin/main` at `00df011` (the remote has no `master` branch); see [verification record](../verification/2026-09-30-personal-workspace.md). The primary checkout and its local edits remain intact.

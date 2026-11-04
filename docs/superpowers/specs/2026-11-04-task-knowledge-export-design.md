# Knowledge Hub — Task Knowledge Export Design

**Status:** Approved, 2026-11-04 (manual MVP supersedes automatic-ingestion v0.1)
**Scope:** Manual Skill/Command trigger + Agent-generated summary + shared CLI + Task Ingestion API + My Space.

## 1. Why and success

After completing a Claude Code or OpenCode task, a developer invokes `/hub-export`. The Agent produces a factual, structured summary of the task, and a shared CLI uploads it securely. Knowledge Hub stores the result as a reusable knowledge asset and resolves explicitly referenced Wiki documents. This is not a task manager, conversation recorder, or alternative to the existing company wiki.

Success: one command from a configured project yields a new Task Result, visible only to its My Space owner, with verification status and traceable Wiki references. No browser copy/paste is required per task.

## 2. Approved decisions and alternatives

| Concern | MVP choice | Deferred alternative |
| --- | --- | --- |
| Trigger | Manual `/hub-export` | Stop/Idle Hooks and automatic detection |
| Summary | Current Claude Code/OpenCode Agent | Hub-hosted LLM |
| Tooling | Shared Skill + CLI, optional OpenCode command adapter | MCP write server |
| Target | Owner's My Space only | Team Workspace auto-export |
| Source binding | One-time Local Project → My Space → FOLDER_SYNC Wiki Source | Per-task selection |
| Connections | Explicit Wiki references scoped to bound Source | LLM semantic matching |
| Storage | Independent Task Knowledge asset and revision | Converting to editable Wiki |
| Reliability | Idempotent API, manual retry | Persistent Outbox and daemon |
| Future | MCP retrieval, automatic Hooks, graph integration | Not required to ship MVP |

## 3. Existing system boundaries

The existing `sources` module owns folder snapshots, SourceEntry mappings, and revisions. Keep Folder Sync's immutable snapshot/Preview/Confirm/Apply contract and SOURCE_MANAGED read-only policy unchanged. The existing My Space has an owner and lifecycle; the existing graph supports DOCUMENT and UNRESOLVED nodes, not Task nodes. Use MariaDB and Next.js; no GPU, LLM service, embeddings, Graph DB or CodeGraph required.

## 4. User flow

1. A browser-authenticated user in an ACTIVE PERSONAL My Space selects an ACTIVE FOLDER_SYNC Wiki Source and creates an Export Binding and a restricted credential.
2. Once, the user configures a CLI for the local project, with source-root mapping kept locally. Credential input must not appear in shell history, Agent prompts, command arguments or Git.
3. The user completes a task and invokes `/hub-export`.
4. The Agent summarizes the current task into a versioned JSON artifact, based only on available evidence. It must not invent tests, changes or references.
5. CLI validates allowed fields and payload size, obtains the binding and secret from local configuration, then posts HTTPS to Knowledge Hub. On failure the artifact remains available for the user to explicitly retry.
6. Server derives owner/workspace/source from the restricted credential and verifies current state. The server atomically persists the task, revision and its references, and replies with the result URL.

This MVP does not auto-detect task completion. Only completed tasks can be exported; an incomplete/failed task must not be labeled completed. `/hub-export` must not send full conversation history or hidden reasoning.

## 5. Artifact contract

Version 1 required fields: `schemaVersion: 1`, stable `taskId`, positive `artifactRevision`, `bindingId`, `agent`, `status: completed`, non-empty `title`, `summary`, `completedAt`, `verification.status` (`passed`, `failed`, `not_run`, `not_applicable`). Optional: `findings`, `decisions`, `changes`, `references`, and check descriptions. Verification is self-reported evidence, not certification by Hub.

Reference types: WIKI (exact Source-relative path or validated Document ID); CODE_FILE (safe project-relative location); COMMIT (opaque identifier); PR_URL (policy-compliant HTTP(S) URL). Non-WIKI references stay external. No full source contents, raw terminal logs or environment variables. MVP limit: 64 KiB artifact, 32 references, bounded string fields; reject unsafe, unknown and oversized data without silent truncation. The local client should scan for forbidden content but this is not a guarantee that all secrets can be detected.

Task identity must remain stable across retries; create/reuse a stable local artifact before the first POST. The CLI must never invent a second Task ID when retrying the *same saved artifact*.

## 6. Project Source Binding / security

Binding is scoped to `ownerUserId`, `personalWorkspaceId`, `sourceId`, non-sensitive `projectKey`, `status`, timestamps. Local absolute paths are not sent to Hub. A human-readable label is allowed. Users can revoke/replace bindings and export credentials. Historical task references preserve original bound source identity.

Use high-entropy opaque credentials scoped only to `task-result:create` for one binding. Server stores a hash, not plaintext. Present the token only once during browser-authenticated setup; CLI accepts it through a hidden interactive prompt, never as ordinary argv. Store local material in OS credential storage where available or a permission-restricted user configuration. Credential cannot confer generic `document.write` or `source.manage`.

Each ingest rechecks credential status, binding status, Workspace `PERSONAL`, `ACTIVE`, owner equality, Source ownership and `ACTIVE` lifecycle. Workspace must be locked in accordance with the application's lifecycle mutation rules. Never accept caller-provided Owner or Workspace identity. Team or cross-workspace writes are forbidden.

## 7. Ingestion and references

`POST /api/task-results/ingest`: 201 new revision; 200 exact replay; 400/422 invalid payload; 401 invalid credential; 403 revoked/out-of-scope; 409 same revision with differing content; 429/503 retryable. Response must be private and uncached.

Task identity unique by `(ownerUserId, bindingId, taskId)`; revision unique by `(taskResultId, artifactRevision)`. Same revision with the same canonical content hash is a no-op replay; different content is rejected. Concurrent POSTs cannot produce duplicate tasks or partial revision/reference rows. A new revision retains prior revisions.

Explicit Wiki resolution uses **only** `(bound sourceId, normalized exact sourcePath)` or a validated Document ID. Never use existing Wiki Link title ranking to assert a unique Task reference. Only ACTIVE Source, SourceEntry and Document are eligible. Missing: UNRESOLVED; multiple/ambiguous: AMBIGUOUS; later revoked/archived: UNAVAILABLE. Save the original locator and resolved Document ID. Following a reference always rechecks live authorization/lifecycle. A stored historical ID is not a capability.

## 8. My Space UI

A small Task Results list/detail view within My Space, without a new top-level sidebar entry. Show title, agent, completedAt, summary, findings, decisions, changes, verification and checks, linked Wiki/external references, status, and revision history. Existing Folder Sync, Document Graph, and Agent Context APIs remain unchanged. Task Result is a distinct Knowledge Asset, not a Wiki Document.

## 9. Failures and tests

- Agent has partial context: summarize only supported facts, do not infer passing tests.
- Export aborted/offline: retain input and enable explicit retry, no background daemon in MVP.
- Replay/concurrent upload: unique constraints + transaction enforce idempotency.
- Workspace revoked/archived or token revoked: reject without fallback to another Workspace.
- Source moved/archived or paths collide: preserve original reference, do not guess.
- Data policy: reject overly broad content, secret-like data and traversal paths; do not log secrets.
- Both Claude Code and OpenCode support the same Schema and intended `/hub-export` command.

Definition of done: one manual command in either tool produces a factual Task Result in My Space, handles failure safely, and provides accurate explicit Wiki references with no cross-workspace disclosure. Unit, integration and E2E testing required.

## 10. Deferred

Automatic Hook/Plugin, persistent retry Outbox, MCP, complete conversation history, Team auto-export, semantic relations, CodeGraph, Task nodes in the general Graph, PDF/binary storage, historical Session backfill and automatic Wiki updates. Later work must be designed separately and aligned with existing Phase 7–9 Roadmap.

# MVP Discovery and Agent Implementation Plan

**English** | [繁體中文](2026-10-04-mvp-discovery-agent.zh-TW.md)

> **For agentic workers:** Use superpowers:executing-plans to implement sequentially in the current session. The user requested execution.

**Goal:** Reliable source scope, precise discovery, and bounded manual Agent context.
**Architecture:** Extend source/snapshot contracts, existing search service, and add one authorized knowledge read use case. Use existing MariaDB unit of work and compact design tokens.
**Tech Stack:** Next.js, TypeScript, React, MariaDB, Vitest, Playwright.
**Spec:** ../specs/2026-10-04-mvp-discovery-agent-design.md

## Global Constraints

No editor/image changes, external AI requests, deployment or main merge. Preserve source-managed ownership, immutable revisions, workspace policy, Preview/Apply atomicity and all existing limits.

## Review Focus

- Cross-device rules and stale versions cannot silently expand scope.
- Excluding previously imported notes must remain visible as archives.
- Literal SQL wildcard characters and neighboring folder names cannot broaden path matches.
- Inclusive dates cover both calendar endpoints in the selected UTC offset.
- Cross-workspace, archived and oversized context selections return no partial content.

### Task 1: Source scope

Files: source/snapshot domain and repositories, migration 015, create/apply services, import scope read service, import form/settings/preview, client scanner.
- [x] Write unit and integration assertions for scope persistence/hash, first-import exclusions and stale versions; run RED.
- [x] Implement source rules, immutable snapshot scope, guarded Apply persistence and authorized GET settings.
- [x] Wire form and Sync now to authoritative settings; show proposed changes/count in Preview.
- [x] Run affected tests and commit.

### Task 2: Search

Files: search-filters domain, search input/criteria/repository, web projection/page/form/pagination.
- [x] Write assertions for strict path/date/offset validation and SQL parameterization; run RED.
- [x] Implement inclusive date bounds, literal path prefixes and deterministic sorts in existing query.
- [x] Wire fields, invalid input feedback, filter-only search and URL pagination.
- [x] Run scoped search tests and commit.

### Task 3: Agent context

Files: knowledge context domain/application, composition/API, personal context page/selector/navigation and reader entry.
- [x] Write tests for policy, workspace binding, archived placements, duplicate IDs, 20-document and 256-KiB limits; run RED.
- [x] Implement one-transaction current-revision bundle reads and private endpoint.
- [x] Add multi-selection page, read-only preview, clipboard/fallback and clear-on-change behavior.
- [x] Run unit/integration/browser flows and commit.

### Task 4: Verification

- [x] Run full unit/typecheck/lint/build and affected integration/browser suites; record browser environment block.
- [x] Review final diff against spec and record verification and practical limits.
- [x] Preserve reviewable feature branch; no main merge or deployment.

## Verification recorded 2026-10-04

- Full unit: 1,651 tests across 129 files passed, including DOM selection/preview/clipboard fallback and timezone navigation regression.
- Full MariaDB integration: 643 tests across 62 files passed, including Apply rollback/rule persistence, stale settings, literal path/date boundaries and context workspace/archived selection checks.
- Typecheck, ESLint and production build passed.
- Fresh independent whole-branch review found two P2 issues (optional browser preferences blocking source settings and stale timezone state) plus implicit migration. All fixed with regression coverage. No critical authorization or atomic Apply defects identified.
- Two browser tests were attempted against the built app and isolated MariaDB. Browser launch failed before page execution because this environment denies Unix socket creation (Chrome process singleton). They remain unverified end to end; DOM tests cover context interactions. Existing folder reading browser test updated for Apply-only rule persistence.
- No main merge or deployment. Schema migration 015 ships with the branch and must run through the existing migration workflow before rollout.
- Testing fixture correction: SQL timestamp literals inherited the server session zone. Date boundary fixtures now use bound UTC Date values, matching repository behavior.

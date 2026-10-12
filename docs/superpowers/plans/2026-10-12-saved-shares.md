# Saved Shares Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Let signed-in recipients save shared articles to a separate Saved shares section in their personal Shares page.

**Architecture:** Add a recipient-owned saved-share relation, repository, and caller-required knowledge application service. Keep public document reading and its bearer-token rules unchanged; the client bookmark control and personal Shares page use authenticated APIs. Valid list rows read current public metadata, while unavailable rows use their save-time snapshots.

**Tech Stack:** Next.js 15, React 19, TypeScript, MariaDB 10.11, Vitest, Playwright; existing UI tokens and controls; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-12-saved-shares-design.md` (approved by the user's continuation after review).

## Global Constraints

- Every public service entry takes a required `CallerContext`.
- Saving does not grant sender workspace membership, search, history, or edits.
- Keep ordinary favorites, Home updates, search, and Insights statistics unchanged.
- Store no Markdown, attachments, revisions, copied content, or token in the saved relation.
- Unique `(user_id, share_link_id)`; soft removal through `removed_at`.
- Pagination: 50 rows, newest `saved_at` first with stable ID tie-breaker.
- `My shares` / `Saved shares`; `Save share` / `Saved`; `Saved to Shares`.
- Unavailable links expose saved metadata only; invalidity reasons stay generic except already-public expiry.
- Mutations require the existing same-origin check. Recipient responses use `Cache-Control: private, no-store`.
- Default Shares route remains the existing owner-management section.
- Follow `CLAUDE.md` and `docs/superpowers/specs/frontend-design-language.md`.
- No new login provider, automatic login-and-save continuation, Team feature, or dependencies.

## Review Focus

- Revocation during a click: persistence never grants content access; a subsequent public read rejects the revoked token. Task 1/4 test this.
- Search after a private title change: unavailable saved rows cannot match or expose the new title or sender metadata. Task 1 test this.
- A delayed state request during navigation: the previous article's saved state must not overwrite the current article. Task 3 test this.
- Concurrent saves from two tabs: return the same record ID without changing its original saved time or creating duplicate rows. Task 1 test this.
- Expired links with duplicate saves of the same document: different share-link IDs retain independent lifecycle and removability. Task 1/4 test this.

---

## File and interface map

- `src/modules/knowledge/domain/saved-share.ts`: recipient record/query/view types and pure query validation.
- `src/modules/knowledge/ports/saved-share-repository.ts`: recipient-scoped persistence and bounded metadata projections.
- `src/modules/knowledge/application/saved-share-service.ts`: trusted user, personal destination, live-token validation, save/state/list/remove.
- `src/infrastructure/database/mariadb/migrations/019-saved-document-shares.ts`: additive table and indexes.
- `src/infrastructure/database/mariadb/repositories/saved-shares.ts`: SQL implementation, safe public/snapshot projections and literal LIKE matching.
- Existing migrations index, repositories index, knowledge unit-of-work type, and server composition: register the new adapter/service.
- `src/server/saved-share-http.ts`: authenticated private response and origin boundary.
- New routes under `src/app/api/saved-shares` and workspace `saved-shares`: thin service adapters.
- `src/components/knowledge/save-share-button.tsx`: bookmark action with authenticated state and retry.
- `src/components/knowledge/shares-navigation.tsx`: route-backed sections, reused by both views.
- `src/components/knowledge/saved-shares-view.tsx`: saved rows, filters, pagination, remove/error/empty states.
- Existing public share page, Shares page/management view, bilingual user guide: integrate these components without duplicating page headers.

### Task 1: Recipient persistence and application authorization

**Files:** Create the domain, port, service, migration and SQL adapter above; modify `src/infrastructure/database/mariadb/migrations/index.ts`, `src/infrastructure/database/mariadb/repositories/index.ts`, `src/modules/knowledge/ports/unit-of-work.ts`, `src/server/composition.ts`; create `tests/unit/saved-share.test.ts`, `tests/integration/saved-share-service.test.ts`. Update typed repository fixtures only where required by the new port.

**Interfaces:**

- `SavedShareQuery = { q: string; status: 'all' | 'available' | 'unavailable'; page: number }`.
- `SavedShareInput = { q?: string; status?: string; page?: string }`.
- `parseSavedShareQuery(input: SavedShareInput): SavedShareQuery`: defaults empty q, all, page 1; q at most 200 characters; page decimal integer 1–100000; invalid inputs use existing `ValidationError`.
- `SavedShareSnapshot = { link: DocumentShareLink; validity: { documentStatus: 'ACTIVE' | 'ARCHIVED'; sourceStatus: 'ACTIVE' | 'ARCHIVED'; workspaceLifecycle: 'ACTIVE' | 'ARCHIVED' | null; creatorDirectRole: WorkspaceRole | null | undefined }; title: string | null; sharedByName: string | null }`.
- `SavedShareRecord = { id: string; userId: string; shareLinkId: string; savedTitle: string; savedSharedByName: string; savedExpiresAt: Date; savedAt: Date; updatedAt: Date; removedAt: Date | null }`.
- `SavedShareView = { id: string; title: string; sharedByName: string; savedAt: Date; expiresAt: Date; updatedAt: Date | null; status: 'available' | 'expired' | 'unavailable'; path: string | null }`.
- `SavedShareState = { saved: boolean; id: string | null; workspaceId: string }`.
- `SavedShareList = { query: SavedShareQuery; items: SavedShareView[]; hasNext: boolean }`.
- Port methods: `findSnapshotByToken(token: string): Promise<SavedShareSnapshot | null>` (one consistent read of grant inputs, title and sender metadata); `findByToken(userId: string, token: string): Promise<SavedShareRecord | null>`; `save(record: SavedShareRecord): Promise<SavedShareRecord>`; `remove(userId: string, id: string, now: Date): Promise<boolean>`; `list(userId: string, query: SavedShareQuery, now: Date, limit: number, offset: number): Promise<SavedShareView[]>`.
- `SavedShareService(unitOfWork: KnowledgeUnitOfWork, clock: () => Date = () => new Date())` with `state(caller: CallerContext, token: string): Promise<SavedShareState>`, `save(caller: CallerContext, token: string): Promise<SavedShareState>`, `remove(caller: CallerContext, id: string): Promise<void>`, `list(caller: CallerContext, workspaceId: string, input: SavedShareInput): Promise<SavedShareList>`.
- Composition exposes `savedShares: SavedShareService`; `KnowledgeRepositories` exposes `savedShares: SavedShareRepository`.

- [x] **Write failing tests** named `validates_saved_query`, `saves_live_foreign_share_without_membership`, `deduplicates_concurrent_save`, `resaves_removed_record`, `isolates_recipient_state_list_and_remove`, `removal_survives_expiry`, `keeps_different_links_independent`, `uses_snapshot_after_revocation`, and `does_not_count_a_list_or_save_as_a_view`. Assert 50/1 pagination boundaries, literal `%_!` search, unknown ID rejection, and that `PersonalService.put` still rejects the foreign document. Schema verification uses real concurrent saves and soft-removal behavior in service integration tests, plus a migration review for restrictive FKs and absence of token/body/workspace fields. A separate schema snapshot test was intentionally not implemented.
- [x] **Run the new unit and integration tests and record the expected missing-module/schema failures.** Use the existing isolated integration runner (`npm run test:integration`); do not assume it forwards file arguments.
- [x] **Implement the domain types/query parser and migration 019.** Register the migration; take column sizes for saved title and sender name from existing revision/user schema so valid public metadata fits without truncation.
- [x] **Implement `MariaDbSavedShareRepository` and register it.** Use recipient-scoped SQL predicates and atomic duplicate-key handling that leaves an active record's ID/time unchanged, but revives a removed record. List filters before LIMIT/OFFSET, selects 51 rows for the service, and uses CASE projections to suppress token/current title/name/update time unless the link is live. SQL validity matches the domain evaluator (expiry, revocation, document/source/workspace lifecycle, creator direct readable role; legacy null role is readable). Integration tests compare against the evaluator for every invalidity class. No N+1 public reader calls.
- [x] **Implement `SavedShareService` and composition.** Synchronize trusted identity where necessary; derive and authorize the active personal workspace via `findPersonalByOwnerUserId`. `list` also proves the requested workspace is that personal workspace. Save looks up a random UUIDv4 token using the repository snapshot read, captures validity inputs/current revision title/creator name in that single statement, and calls `evaluateShareLinkValidity`; no Markdown copy or `readShared` call. State can return an own saved record even after expiry; an unknown/non-owned token yields the same unsaved result. Remove validates a UUID ID and returns not found for other users, while repeated removal of the same owned record succeeds.
- [x] **Add and pass lifecycle/privacy tests:** all invalidity classes reject new saves with `SHARE_LINK_NOT_FOUND`; archive restoration only re-enables an unexpired/unrevoked share; unavailable search uses snapshot fields; transport/DB failures propagate; lists expose neither Markdown nor sender-only statistics. Saving immediately before revocation never makes the public reader succeed afterward.
- [x] **Run new/existing sharing and personal tests, typecheck, and the caller-less boundary guard.** Commit this tested deliverable as `feat: persist recipient-owned saved shares`.

### Task 2: Authenticated HTTP boundary

**Files:** Create `src/server/saved-share-http.ts`, `src/app/api/saved-shares/state/route.ts`, `src/app/api/saved-shares/route.ts`, `src/app/api/saved-shares/[id]/route.ts`, `src/app/api/workspaces/[workspaceId]/saved-shares/route.ts`, `tests/unit/saved-share-http.test.ts`, `tests/integration/saved-share-api.test.ts`.

**Interfaces:**

- `savedShareHttp(request: Request, work: (services: ReturnType<typeof applicationServices>, caller: CallerContext) => Promise<unknown>, status?: number): Promise<Response>`.
- GET state returns `SavedShareState`; POST save JSON `{ token: string }` returns `SavedShareState` with 200 for both first and duplicate saves; DELETE owned ID returns 204 with no body; workspace GET returns `SavedShareList`.
- JSON errors keep existing `{ error: { code, message } }` mapping. Existing origin check and trusted caller establishment precede mutation service calls.

- [x] **Write failing tests** `requires_trusted_caller`, `rejects_cross_origin_mutations`, `validates_save_body`, `does_not_accept_recipient_from_client`, `returns_private_no_store_on_success_and_error`, `removes_unavailable_owned_share`, and `hides_foreign_record`. Include missing/malformed Origin, configured public origin, malformed JSON/arrays, invalid token/ID, unknown tab-independent list filters, and unavailable identity provider.
- [x] **Run tests to confirm missing routes/boundary fail.** Then implement the thin HTTP adapter, reuse `assertReviewOrigin` and `requestFields`, and call Task 1 service signatures without repository access or optional caller fallback.
- [x] **Run unit HTTP tests and isolated integration API tests.** Assert mutation CSRF failures never invoke save/remove and tokens are absent from logged errors. Confirm 204 is bodyless. Commit as `feat: expose authenticated saved-share APIs`.

### Task 3: Bookmark action on the public reader

**Files:** Create `src/components/knowledge/save-share-button.tsx` and `tests/unit/save-share-button.test.tsx`; modify `src/app/s/[token]/page.tsx`.

**Interfaces:** `SaveShareButton({ token }: { token: string }): ReactElement`; consumes Task 2 state/save/remove APIs. Uses bookmark icon, existing Button/focus/typography tokens, visible `Save share` / `Saved`, and `aria-pressed`.

- [x] **Write failing tests** `loads_saved_state`, `saves_and_links_to_personal_saved_section`, `disables_pending_duplicate_clicks`, `removes_without_revoking`, `keeps_article_readable_when_signed_out`, `distinguishes_auth_unavailable`, `retains_state_on_network_failure_and_retries`, and `ignores_old_state_response_after_token_change`. Successful save must link to `/w/:workspaceId/shares?tab=saved`; no success message before API confirmation.
- [x] **Run the tests to see the missing component fail.** Implement cancellable state loading keyed by token and a pending action guard; reset transient state on token change. A failed initial state load permits an explicit retry without pretending the article is unsaved. Authentication-required feedback uses the existing `/s/:token/open` entry and explains that the user must return to save; do not invent automatic continuation.
- [x] **Integrate the control in the public header** beside the existing explicit app entry, wrapping on mobile; retain anonymous server rendering, no workspace shell/tree/link resolutions, and no share token in telemetry.
- [x] **Run component tests and `tests/unit/share-link-single-exception.test.ts`**, then typecheck/lint. Commit as `feat: let signed-in readers save shared articles`.

### Task 4: Shares sections, guide, and complete flow

**Files:** Create `src/components/knowledge/shares-navigation.tsx`, `src/components/knowledge/saved-shares-view.tsx`, `tests/unit/saved-shares-view.test.tsx`, `tests/e2e/saved-shares.spec.ts`; modify `src/app/w/[workspaceId]/shares/page.tsx`, `src/components/knowledge/share-management-view.tsx`, `src/components/help/user-guide-content.ts`, `tests/unit/share-management-view.test.tsx`, `tests/unit/import-guide-content.test.ts`. Update the existing E2E service-selection mapping only if discovery shows the new spec is missing the required trusted personas. Write evidence to `docs/superpowers/verification/2026-10-12-saved-shares.md` and synthetic screenshots under `docs/ui-comparisons/saved-shares/`.

**Interfaces:**

- `SharesNavigation({ workspaceId, active }: { workspaceId: string; active: 'mine' | 'saved' }): ReactElement`: real route links with `aria-current`; normal nav semantics rather than tabs with missing keyboard behavior.
- `SavedSharesView({ workspaceId, model, filterError }: { workspaceId: string; model: SavedShareList; filterError?: string }): ReactElement`.
- Existing Shares search params add `tab?: SearchParamValue`. Absent/mine routes use existing owner management; saved routes call Task 1 list service. Unknown tabs produce an explicit validation message, never a foreign workspace fallback. Only the selected section is fetched.

- [x] **Write failing UI tests** for both section links, default route compatibility, saved filter/pagination URLs retaining `tab=saved`, no-results/empty/error states, available-row navigation, disabled unavailable Open, remove failure recovery, and absence of favorite/revoke/view-count actions. Assert desktop/mobile row semantics and keyboard focus using existing controls.
- [x] **Run tests to confirm missing view/navigation behavior fails.** Implement section navigation in both existing and new views, without duplicate page headers. Saved section defaults All, displays live or saved metadata per Task 1 contract, provides Refresh, and keeps failed removals visible. Remove success refreshes the list; invalidity explanations remain generic. Use existing Shares illustration for an unfiltered empty list and Clear filters for a filtered empty list.
- [x] **Update both guide languages and guide tests** with the distinction between owned favorites and saved shares, login requirement, link-controlled lifetime, and Remove versus Revoke.
- [x] **Write and run E2E** on trusted `reviewOwner` and a separate recipient persona using existing phase3 fixtures. Test UI Save → Saved shares → Open, owner content update visible on Open, a fresh browser context retaining saved state, recipient removal, and owner revocation showing unavailable/removable. Test signed-out/unconfigured origins and explicit network failure/retry. Assert recipient still cannot read the sender workspace or favorite its document. Two links for one document remain independent.
- [x] **Run `npm run test:unit`, `npm run typecheck`, `npm run lint`, `npm run build`, and `npm run test:integration`.** Run `PLAYWRIGHT_BROWSERS_PATH=/workspace/.playwright-browsers npm run test:e2e -- tests/e2e/saved-shares.spec.ts tests/e2e/share-link.spec.ts tests/e2e/shared-review.spec.ts`. Run further suites only for an identified dependency or failure; preserve ordinary sharing/review access tests.
- [x] **Capture desktop/mobile, light/dark screenshots** of the public Save/Saved control, My shares, Saved shares, and an unavailable row using synthetic data. Record the exact commands and pass/fail counts in verification evidence; review overflow and focus states. Remove any generated modifications unrelated to this feature.
- [x] **Commit the tested interface/guide/evidence deliverable** as `feat: separate saved articles from outgoing share management`. Review the whole diff for spec coverage, caller boundaries, privacy, and migration compatibility. Report implementation and validation outcomes; create or merge a PR only when requested.

## Plan review status

The written spec is approved. This plan has been checked for spec coverage,
matching types/interfaces, review-focus tests, and repository-supported commands.
The user approved the plan and selected inline execution. The four tasks were
implemented and verified. Final review added the atomic snapshot-read interface to prevent a revocation/metadata race. Schema coverage lives in the service integration
tests rather than a separate implementation-mirroring schema snapshot. See
`docs/superpowers/verification/2026-10-12-saved-shares.md` for commands,
results, implementation adjustments, and the final independent review.

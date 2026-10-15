# Knowledge Verification — design specification

| Item | Decision |
| --- | --- |
| Proposed | 2026-10-14 (Asia/Taipei); confirmed 2026-10-15 |
| Status | Written specification for human review — NOT implementation approval |
| Method | Superpowers architectural brainstorming; design approved in conversation, written spec pending review |
| Project | Knowledge Hub, mike840609/knowledge-hub |
| Scope | My Space and opt-in Team Workspace; current saved Markdown document revision; authenticated Workspace operations |
| Fixed decisions | Verification validity 180 days; only Workspace OWNER/ADMIN may verify or revoke; every new revision requires re-verification |
| Related components | KnowledgeDocument / immutable KnowledgeRevision; Folder Sync; Workspace Governance; document review threads; Agent Context; Reader |
| Explicit exclusions | New Markdown editor, assigned reviewers, approvals workflow, group review, batch verification, reminders, scheduled workers, semantic change classification, cascading verification, automatic AI approval, new SSO implementation |

## 1. Intent and success criteria

Knowledge Hub exposes AI-generated Markdown and hand-authored documents to engineers and PMs. A reader currently sees content, revision history and discussions but has no explicit statement that a responsible person reviewed *this exact saved revision*. A one-time verified flag on the document is unsafe: Folder Sync, browser edits and restoring content may create a new immutable KnowledgeRevision.

Deliver the smallest trustworthy manual attestation: an authorized OWNER/ADMIN can mark the document's **current immutable revision** as reviewed for 180 days; every new revision immediately loses current VERIFIED status. Readers can understand the status, its provenance and the distinction between discussion and attestation. AI Agent Context gets the same status with no new access grant.

Success is observable through user tests: a reviewer can verify the current revision without editing Markdown; another reader sees the evidence; saving a new revision immediately shows NEEDS_REVIEW; historical attestations and audit events survive; no share token or VIEWER/EDITOR privilege can mint a verification.

This is **human review evidence, not a guarantee that the content is objectively correct**, and does not make AI-generated text executable instructions.

## 2. Existing code and architecture baseline

Checked against current main and the existing product contracts:

- src/modules/knowledge/domain/document.ts: stable document ID and currentRevisionId; document lifecycle ACTIVE/ARCHIVED.
- src/modules/knowledge/domain/revision.ts and ports/revision-repository.ts: immutable revision ID, revisionNo and contentHash; source content is title + markdown + metadata.
- src/modules/knowledge/application/internal/create-revision.ts: Hub-owned writes compare expectedCurrentRevisionId; canonical content NOOP preserves revision; actual change creates revision and advances currentRevisionId atomically.
- src/modules/sources: Folder Sync is SOURCE_MANAGED; original local Markdown remains source of truth. Preview/Apply and no-change behavior remain unchanged.
- src/modules/workspaces/domain/workspace-capability.ts: OWNER/ADMIN/EDITOR/VIEWER capabilities; current document.write is available to EDITOR, so it must **not** authorize verification.
- src/modules/workspaces/application/workspace-mutation-guard.ts: source-to-workspace-to-document write locking contract, current-grant recheck, and lifecycle enforcement.
- src/modules/knowledge/application/internal/require-visible-document.ts and knowledge-query-service.ts: document identity is not itself an authorization grant.
- src/modules/knowledge/ports/unit-of-work.ts and infrastructure/database/mariadb/repositories/index.ts: domain service and transaction/repository composition.
- src/modules/knowledge/application/agent-context-service.ts and domain/agent-context.ts: trusted, workspace-scoped agent context containing document and revision provenance; 20-document and 256-KiB output limits.
- docs/superpowers/specs/2026-10-09-shared-personal-document-inline-review-design.md: document-level review threads with paragraph anchors, discussion lifecycle, and limited valid-share-link access. A resolved comment does **not** attest to document correctness.
- Workspace Audit Event repository: append-only governance events committed in the same transaction as relevant changes.

Company SSO is provided by trusted integration points, not shipped login UI. Team Workspace is disabled by default. The new feature must work with development Local identity for tests while preserving the production identity gate.

## 3. Architecture choice and alternative analysis

Three options were evaluated:

1. Document verified boolean: cheapest to display, but falsely survives document edits. Rejected.
2. Verification metadata inside KnowledgeRevision or Markdown: contaminates immutable revision/content hashing; SOURCE_MANAGED Markdown becomes a second writable copy. Rejected.
3. **Append-only revision-targeted verification events owned by the Hub**, derive live state against currentRevisionId. Selected.

### 3.1 Relationship to existing inline review

Inline comments and knowledge verification belong to the same conceptual **Knowledge Review & Trust** area but solve different decisions:

| Axis | Existing Inline Review | New Verification |
| --- | --- | --- |
| Question | What should be discussed or corrected? | Did an authorized person assess the current revision? |
| Object | Document threads; paragraph anchors | Exact immutable revision |
| Actions | Comment, reply, resolve/reopen, hide | VERIFY, REVOKE |
| Authorization | Owner route or token + trusted identity for limited discussion writes | ONLY authenticated Workspace OWNER/ADMIN; no share token authorizes verification |
| New revision | Threads persist; anchor may become outdated | Prior attestation persists historically, current status becomes NEEDS_REVIEW |
| Completed action | RESOLVED is discussion state | VERIFIED is revision-specific attestation |

**Reuse shared infrastructure, not shared state:** caller identity, document visibility, Workspace scope, current revision lookup, audit plumbing, Reader context and error conventions. Keep existing comment thread/reply tables, anchoring, endpoint contracts and visibility unchanged. Create a distinct verification event repository because verification actions have different integrity, security and retention requirements. Do not build a second threaded-review framework or separate review-management UI.

MVP neither requires resolving all open comments before verification nor auto-verifies when comments resolve. Future workflows can reference both independent signals without conflating them.

## 4. Scope and user experience

### 4.1 Viewer

For a current, accessible, ACTIVE document, display a compact badge near the title or existing details strip. Selecting it opens a small details panel with status, revision number, verified timestamp, review due timestamp and the authorized reviewer name only inside an authenticated Workspace document reader. Provide a view of verification history, paginated and separate from revision content history; historical revisions show **historical attestation information**, never a green current-revision badge.

Status copy:

- UNVERIFIED — Not verified (no past verification events).
- VERIFIED — Verified for current revision.
- NEEDS_REVIEW — Content changed since last verification.
- EXPIRED — The current revision's verification expired.
- REVOKED — Verification for the current revision was revoked.

Unknown/unavailable data is not displayed as VERIFIED. The existing comments entry/rail remains where it is. A resolved thread is not a verification prerequisite or a substitute.

### 4.2 Authorized reviewer

Workspace OWNER/ADMIN can select "Verify current revision" in the existing document actions/details. The action displays the target revision and optional note (maximum 500 Unicode characters), uses expectedRevisionId from the page, and updates on success. Optional "Revoke verification" requires confirmation; it never deletes the verification event or old evidence. No change to Markdown is performed.

Only one current-version badge is shown. A separate full-page Team verification dashboard, named reviewer assignment, notifications and scheduled expiration processing are not included.

### 4.3 Anonymous document share

The share page is still a bearer-link read of current content, not a Workspace authorization grant. It MAY expose a **minimal current verification status** with a current-revision label, only after current link validity and all existing share lifecycle checks pass. It does not expose reviewer user ID, employee number, internal comments, notes, event history or authentication-only actions. The share token cannot call Workspace verification endpoints. If support for this read requires large changes to the share projection, defer the display rather than weakening the boundary.

### 4.4 Archived content

On ARCHIVED Document, Source or Team Workspace, new verification/revocation operations are forbidden; existing events are immutable. Authorized archival readers may inspect historical evidence through their existing archived-document mechanism. Restore does not mint or prolong an attestation. If restore merely changes lifecycle and currentRevisionId remains identical, the ordinary revision/time-based state is derived (no implicit fresh verification); if restore creates a new revision ID, the new revision needs review.

## 5. Data model

Introduce append-only document_verification_events (new numbered MariaDB migration):

| Field | Type | Contract |
| --- | --- | --- |
| id | UUID | UUIDv7 event ID, primary key |
| document_id | UUID | FK to knowledge_documents.id |
| revision_id | UUID | Paired FK (document_id, revision_id) to knowledge_revisions(document_id, id) |
| event_no | BIGINT UNSIGNED | Per-document monotonically increasing sequence; UNIQUE(document_id, event_no) |
| action | VARCHAR(8) ascii_bin | VERIFY or REVOKE only; DB CHECK |
| actor_user_id | UUID | FK to users.id, required |
| note | VARCHAR(500) | nullable, reviewer-authored (do not expose anonymously) |
| review_due_at | DATETIME(6) | required only on VERIFY; null on REVOKE, enforced by CHECK |
| created_at | DATETIME(6) | Server-generated UTC instant, immutable |

Indexes: (document_id, event_no) unique and descending-efficient latest event query; (document_id, revision_id, event_no) for historical views. Referenced entities have RESTRICT deletes, consistent with archival rather than hard delete. Do not add status/verified flag to knowledge_documents, knowledge_revisions or Markdown/frontmatter. Event note has length validation and HTML/Markdown rendered as inert text.

The authorizing Workspace ID is derived through Document -> Source -> Workspace at each operation and audit event. Verification Event is domain evidence, and workspace_audit_events is the separate general-purpose governance log; both are written atomically.

To avoid ambiguous ordering when timestamps tie or app clocks differ, event_no is assigned while holding the Document row lock. DB unique key provides a second integrity guarantee. Event UUIDv7 is an identifier, **not** the authoritative order.

## 6. Deterministic state machine

All status calculation uses server time (UTC) and **the current document revision ID at query time**. It does not require a periodic job.

Definitions: E = latest document verification event by event_no; R = currentRevisionId; now = server-provided clock. review_due_at = verification createdAt + exactly 180 × 24 hours (UTC duration).

Evaluation order:

1. No verification event: UNVERIFIED.
2. Latest event targets a revision other than R: NEEDS_REVIEW.
3. Latest event is REVOKE for R: REVOKED.
4. Latest event is VERIFY for R and now >= review_due_at: EXPIRED.
5. Otherwise (VERIFY for R and before due): VERIFIED.

A new immutable revision always differs in ID and is therefore NEEDS_REVIEW, **even if restored content or a metadata-only change resembles an earlier revision**. A canonical NOOP that does not insert a revision does not invalidate verification. Same-content import Apply without a revision change similarly does not invalidate.

A subsequent successful VERIFY on current revision always supersedes older events as the latest evidence; it is required to restore VERIFIED after expiry, revocation or version advancement. Notes and history remain. No automatic transfer of past attestations to new versions.

Duplicate VERIFY for an already actively VERIFIED **same revision** returns the current state without writing a second event (idempotent NOOP). When current state is EXPIRED or REVOKED, VERIFY creates a new event and resets due date. Duplicate REVOKE for currently REVOKED same revision is a NOOP. REVOKE otherwise requires the most recent event be VERIFY for **current revision**; an older-revision attestation cannot be revoked through the current action. Allow revocation of an expired verification on the same revision to formally retract it.

If no prior verification exists, users see UNVERIFIED even after several unverified revisions. If an old verification was revoked and a later new revision appears, status is NEEDS_REVIEW, while history explicitly shows the prior revocation.

Historical-revision pages are read-only and label past VERIFY/REVOKE evidence for that revision, never claiming an old revision is the current VERIFIED revision.

## 7. Authorization, identity and transaction/locking

Add explicit WorkspaceCapability document.verify **only** to ADMIN capabilities (OWNER inherits). EDITOR and VIEWER never receive it. For My Space, the existing single owner membership grants OWNER. Team Group mapping can grant ADMIN, with the same trusted validated external-group checks currently used for capabilities.

No browser-supplied actor ID, reviewer name, Workspace ID, share token or role authorizes a write. Each API operation establishes trusted CallerContext. The backend authoritatively resolves Document -> Source -> Workspace; respects Team rollout setting, Personal owner shape, Workspace lifecycle, Source/Document archived status, and rechecks capabilities within the transaction.

Reuse the existing mutation guard and extend its operation discriminants with verification metadata mutation. It must **not** be classified as content-write (would incorrectly demand document.write and may exclude source-managed documents). Extend Personal policy to allow the verification operation without allowing unrelated governance changes. The write lock order must match the established repository pattern: Source lock -> Workspace shared mutation lock and refreshed grants -> Document FOR UPDATE -> current revision check -> sequence allocation -> event insert and Workspace audit append, all within **one** KnowledgeUnitOfWork transaction. Avoid nested transactions. Workspace archive/membership revocation serialized against writers must not let a newly unauthorized verification commit.

Expect exact expectedRevisionId from client for both VERIFY and REVOKE. Reject mismatch after Document lock with 409 STALE_DOCUMENT_REVISION, including when an existing verification was for a prior revision; reloading the page is required. For two simultaneous eligible VERIFY calls, serialization yields one new event and one idempotent result. A concurrent Hub save or Folder Sync Apply must serialize by the existing document/source/workspace locking discipline; whichever obtains lock and commits first determines whether verifier succeeds or gets 409.

Use existing absence/security error conventions: 401 if no trusted session, 503 if trusted reader unavailable, 404 for hidden/non-discoverable resources (avoid document enumeration), 403 when discoverable but lacking verify permission, 409 for stale current revision. All requests validate active lifecycle before mutation; avoid leaking privileged metadata to anonymous callers.

## 8. Application services and HTTP contracts

Introduce VerificationService within the existing Knowledge module and VerificationRepository in KnowledgeRepositories plus MariaDB adapter. Keep DocumentReviewThreadService untouched; share the caller-scope and reading conventions rather than service/domain state.

Proposed authenticated routes:

| Method | Path | Purpose |
| --- | --- | --- |
| GET | /api/documents/:id/verification | Current status with evidence permitted by document.read |
| POST | /api/documents/:id/verification | Verify exact current revision |
| DELETE | /api/documents/:id/verification | Revoke latest current-revision verification |
| GET | /api/documents/:id/verification/history?cursor=... | Paginated events, document.read required |

Request for POST/DELETE (JSON body): expectedRevisionId required, note optional on POST and optional reason on DELETE (both up to 500 chars); client-selected validity period is rejected. An application-generated 180-day expiry is authoritative.

POST/DELETE response: status, documentId, currentRevisionId, verifiedRevisionId (if applicable), reviewer display name (authenticated document reader only), verifiedAt and reviewDueAt where applicable. Idempotent repeats return the same logical result, without a duplicate event or audit record. No create/update/delete direct access to event rows.

History: server-side order event_no DESC, cursor-based pagination (default 20, maximum 50), no unbounded in-memory scans; include actor identity/display name only for authenticated Workspace members with document.read. Historical content/quote/comment bodies are not returned by verification APIs. The public share projection uses a narrowly permitted status-only response through existing share validity logic, never these routes.

Read currentRevisionId and latest event in a transactionally consistent snapshot, so status cannot be paired with a different saved revision. Where list/search views eventually expose badges, constrain queries to permitted Workspaces and avoid N+1 queries; such list-wide badges are not required by MVP.

## 9. Failure handling, audit and retention

Each actual VERIFY or REVOKE appends an event to document_verification_events and a corresponding event to workspace_audit_events **in the same transaction**. Event types: DOCUMENT_REVISION_VERIFIED / DOCUMENT_VERIFICATION_REVOKED. Audit payload includes documentId, revisionId, eventNo, and reviewDueAt if relevant; does not contain internal note text or full Markdown.

Failures must roll back both writes. If the content is stale or role/membership changed, insert neither. An expired verification is computed at read time; do not write an EXPIRE event or schedule jobs. Treat malformed IDs and notes with validation errors, do not provide cross-workspace existence hints. Preserve immutable evidence across archive and restore; no user-facing hard delete.

Verification API responses containing personal metadata use no-store; client can refresh after mutation or reload. If details read fails, Reader shows a neutral unknown/unavailable indicator, never stale VERIFIED from cache.

## 10. Agent Context integration

Reuse the existing selected-document context service and access checks. Add a compact verification object to each document's provenance, keyed to the **same current revisionId returned in the context**. Fields: status, verifiedRevisionId (nullable), verifiedAt (nullable), reviewDueAt (nullable). No reviewer employee IDs, verification notes, audit logs or unrelated Workspace data. The Markdown remains reference material, not executable instruction. Source selection and size limits (20 documents, 256 KiB) are unchanged, and if verification cannot be safely read with the same revision snapshot it must not falsely claim VERIFIED.

A status is advisory provenance: UNVERIFIED/NEEDS_REVIEW does not remove legitimate context or automatically tell an Agent to ignore it; VERIFIED is not objective truth or permission for action.

## 11. UI integration and product language

Prefer one compact status badge alongside the current document title or existing details area, with a small popover/panel containing recent evidence and a link to history. A document header action for OWNER/ADMIN may VERIFY / REVOKE; it must show the current revision number being targeted. Retain the established Linear-like spacing and typography, mobile layout, keyboard focus, and accessible status text (color alone is insufficient). No full-page review administration interface and no second comments rail.

- Do not call a resolved comment "approved."
- A verified document can still have open threads; avoid implied enforcement.
- Historical revisions show "Historical verification" and a clear current revision distinction.
- Share pages, if status is displayed, must suppress reviewer internal identity and history.
- Invalid/absent trusted identity should not expose clickable write actions, but the server remains the authority.
- Keep zh-TW and EN strings synchronized with existing in-app guide patterns.

## 12. Test strategy and acceptance gates

### Unit / domain

1. No events UNVERIFIED.
2. Current VERIFY before 180-day boundary VERIFIED.
3. Exact 180-day UTC boundary EXPIRED, without background mutation.
4. A new current Revision ID NEEDS_REVIEW, including metadata-only and restoration; no-change NOOP stays VERIFIED.
5. Latest current REVOKE REVOKED; next new revision NEEDS_REVIEW.
6. Re-VERIFY after EXPIRED/REVOKED creates fresh evidence; duplicate active VERIFY and duplicate current REVOKE are idempotent.
7. Old revision view cannot be mistaken for the current VERIFIED state.

### Database/integration

1. Composite FK forbids verification revision from a different document.
2. Event ordering stable on equal timestamps; append-only repository offers no mutation/deletion.
3. Actual writes append event + audit in same transaction; failure rolls both back.
4. Source-managed Folder Sync changes current revision and status automatically; preview NOOP does not.
5. Concurrent verify/verify creates one new event; verify/sync or verify/edit serialized and returns 409 to stale verifier.
6. Concurrent Workspace archive or membership removal cannot permit unauthorized commit.
7. Owner/Admin allowed; Editor/Viewer denied; trusted Team group ADMIN allowed; spoofed/browser group or identity denied.
8. Document or Source archived blocks mutations; restoration never fabricates a new verified event.
9. Unauthorized or anonymous reads cannot enumerate verification metadata.
10. Agent Context status corresponds to exactly the included revision.

### Browser E2E

Use existing separate persona origins (e.g. owner/viewer and a configured-no-session origin for 401); do not attempt multi-user authorization tests with a single environment-variable Local Identity process. Confirm disabled/unavailable production identity correctly produces 503 when expected. Test authenticated Reader badge/details and user flows, keyboard, mobile, comments remaining operational, current-to-new-revision transition and anonymous shared-page privacy. Company SSO actual integration requires company-side validation; do not claim production SSO is delivered by this feature.

## 13. Implementation boundaries and sequencing

One focused implementation plan after written-spec approval:

1. Domain state evaluator and unit tests; immutable event migration/repository.
2. VerificationService; Workspace capability and metadata-write mutation guard; integration tests for locks/roles/rollback.
3. Authenticated read/write API plus no-store privacy contract; API integration tests.
4. Reader badge/actions/history and localized help; browser tests.
5. Agent context provenance extension and integration/E2E coverage.
6. Optional minimal public share status only if it can reuse the existing security-scoped projection without widening tokens.

Files likely involved (final plan must re-check actual main paths): src/modules/knowledge/domain/verification.ts, src/modules/knowledge/application/verification-service.ts, src/modules/knowledge/ports/verification-repository.ts, src/modules/knowledge/ports/unit-of-work.ts, src/infrastructure/database/mariadb/repositories/verification.ts, repositories/index.ts, a new numbered migration, workspace-capability.ts, workspace-mutation-guard.ts, personal/team mutation operation types, authenticated server routes, Reader components, agent-context service/domain, unit/integration/E2E fixtures.

Do not change the existing comment thread data model, inline anchor lifecycle, Markdown ownership or public link grant. Team workspace remains opt-in; company SSO integration remains external.

## 14. Review checklist and decision record

Confirmed with user:
- **180-day** expiry from each verification, measured as UTC elapsed duration.
- **Workspace OWNER/ADMIN only** can verify/revoke.
- **Every new saved revision** must be newly verified; no content diff exception.

Preserved requirements:
- SOURCE_MANAGED stays externally authored.
- Existing comments resolve discussions, never substitute for attestation.
- Same Workspace identity/access/audit and revision invariants underpin both systems.
- The new feature introduces no additional login or sharing grants.
- Architectural direction approved in chat; this written document must be reviewed separately before producing the implementation plan.

Design alternatives and declined scope are recorded above. No feature code, migration or API is implemented by this specification.

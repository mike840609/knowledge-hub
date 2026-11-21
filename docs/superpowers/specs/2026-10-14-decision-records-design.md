# Decision Records — design specification

| Item | Decision |
| --- | --- |
| Date | 2026-10-14 |
| Type | Architectural design specification; implementation is not authorized |
| Status | Proposed written spec, awaiting user review |
| Agreed direction | **B — existing Markdown KnowledgeDocument plus Hub-owned decision metadata** |
| Target | Personal-first MVP, workspace-scoped for both PERSONAL and future TEAM |
| Based on | Repository main at 0713728e11ec8db724e96debed020f13b05af9d9 |
| Related contracts | Phase 0/1 KnowledgeDocument and immutable KnowledgeRevision; Phase 2 folder sync; Phase 3 workspace governance; Phase 5 human authoring; 2026-09-29 knowledge graph; 2026-10-09 inline review |

## 1. Intent, users and success

Knowledge Hub is a companion to the company's Notion-like collaboration system, not a replacement. Engineers and PMs need to answer **why** a design or product decision exists, which alternatives were considered, whether it remains authoritative, and which source material supports it. Existing Markdown documents, including local AI-generated wiki folders, are the content source.

A successful MVP allows an authorized user to mark an existing document as a decision, accept a particular immutable revision, notice when that document changes, reaffirm the new revision, and trace a later decision that supersedes it. Another authorized user can discover and read that state without opening a separate decision database. A folder re-sync must never modify or silently reapprove Hub-owned decision state.

This specification is the authoritative proposed design for the new feature; approval of the earlier conversational approach does **not** authorize an implementation plan or code changes.

## 2. Baseline and constraints verified on main

- The document identity is KnowledgeDocument.id; location belongs to the tree and Source, and immutable content (title, Markdown, metadata) belongs to KnowledgeRevision.
- Workspace scope is derived exclusively by DecisionRecord -> KnowledgeDocument -> KnowledgeSource -> Workspace; document IDs, URLs, or source paths are not authority.
- SOURCE_MANAGED content is modified only through folder re-sync; HUB_MANAGED content uses the existing composer.
- The current graph/backlink index extracts *raw* Markdown links from current revisions and resolves them at read time. It is rebuildable derived data, not a policy or decision-event store.
- The existing capability bundles grant document.read to VIEWER and document.write to EDITOR/ADMIN/OWNER; production Team use still requires trusted SSO.
- Current share tokens expose a narrow public document/current-revision view and permitted review functions only. They grant no workspace tree/search, other revisions, or general metadata APIs.
- MariaDB 10.11, Next.js and the modular monolith are the implementation foundation. The Knowledge module cannot import Sources infrastructure or Next/React/MariaDB directly.
- Existing Markdown ADR headings inside repository design docs are not a structured Decision Records subsystem. This feature must not migrate or reinterpret those historical files automatically.

## 3. Selected design and alternatives

**Selected (B):** Keep one canonical KnowledgeDocument/KnowledgeRevision for content, and attach a one-to-one DecisionRecord with append-only DecisionEvents for Hub workflow metadata.

- A, Markdown/frontmatter-only: maximizes portability but makes acceptance, authorship, revision locks and folder-sync consistency unreliable. Not chosen.
- C, independent decision content entity/editor: facilitates complex approvals but duplicates document ownership, editing, revisions and discovery. Not chosen.
- B lets both AI-produced folder Markdown and Hub-authored Markdown become decisions without rewriting the files.

There is no new standalone editable decision body, no second wiki or editor, and no automatic use of frontmatter status as authority. Importing a file whose frontmatter says “Accepted” does not accept a decision.

## 4. MVP boundary

In scope:

1. Mark an existing, active, readable document as a Proposed decision.
2. Offer a Markdown decision template when creating a new HUB_MANAGED document; saving uses existing authoring, then marking creates the DecisionRecord. Do not leave an orphan record if creation fails.
3. Accept the current revision of a Proposed decision.
4. Show revision drift for an Accepted decision; reaffirm the new current revision explicitly.
5. Supersede an Accepted decision with another Accepted, non-stale decision in the same workspace.
6. Keep append-only state/history events and stable deep links; show Decision details in the existing reader.
7. Provide a workspace-scoped Decisions list with keyword/status and Needs Review filtering.
8. Read and mutate through authenticated application services with revalidated workspace access.
9. EN and zh-TW UI copy/help changes, and unit/integration/E2E coverage.

Out of scope: AI decision extraction or auto-acceptance, PR/issue auto-linking, vector search, typed graph visualization, global ADR numbering, cross-workspace links, multi-party approval, notifications, external authoring, dedicated share-token decision APIs, write-capable MCP, separate review/verification workflows, bulk conversion, and unmark/delete.

## 5. User experience

### 5.1 Existing document -> Decision

An eligible authenticated Editor opens an active document and chooses **Mark as Decision** from its existing action menu. Show a short confirmation: “Adds decision tracking; does not edit the source document.” The record starts Proposed and the first event records the current revision and actor. Source-managed files are treated identically because only Hub metadata changes.

The existing reader then shows a compact Decision header with status, accepted-revision marker if applicable, and related/superseded decision links. Its body, TOC, comments, Markdown links and source provenance remain unchanged. The user sees the original source-ownership distinction; marking does not activate editing for a synchronized file.

### 5.2 New decision

Choose **New decision** in the Decisions view: reuse New Note for the workspace's HUB_MANAGED source with a plain Markdown template containing Context, Decision, Alternatives considered, Rationale, Consequences, and Related knowledge. The initial document is still a normal document. After its first saved revision, create the Proposed record; if marking fails, retain the saved document and clearly offer a retry rather than reporting a wholly successful decision creation.

Do not require headings to match in imported documents. Plain Markdown is readable/editable externally. Do not automatically inject app-only metadata into Markdown.

### 5.3 Accepted / changed / superseded

- **Proposed:** “Accept current revision” records the exact immutable revision chosen.
- **Accepted and current:** reader shows Accepted and the accepted revision/time.
- **Accepted and drifted:** reader shows Accepted + **Needs Review**, identifies both revision numbers, and offers **Reaffirm current revision**; no automatic status transition.
- **Superseded:** reader shows a persistent historical status and **Superseded by [decision]**; it cannot be reaffirmed or accepted again.

The Decisions list is workspace-scoped, not source-limited. Provide All/Proposed/Accepted/Superseded and a derived Needs Review filter; each result has title, Source, status, drift indicator, current/accepted revision, last state update, and a link to its document. Omit archived documents/sources by default; direct owner/admin history access follows the existing includeArchived rules rather than a new ACL. Never disclose hidden document titles or related links.

### 5.4 Suggested template

~~~markdown
# Decision: <title>

## Context
What is the problem or constraint?

## Decision
What approach was selected or proposed?

## Alternatives Considered
- Option A
- Option B

## Rationale
Why is this preferable?

## Consequences
What changes, limitations, and risks follow?

## Related Knowledge
- [[Relevant Architecture]]
~~~

Template headings are advisory. Acceptance requires an extant nonempty document revision, not a parser judgment of the text's quality.

## 6. State machine and semantic invariants

Persist only **PROPOSED**, **ACCEPTED**, and **SUPERSEDED**. **NEEDS_REVIEW is not a persisted status**.

| Operation | From | Preconditions | Result | Event |
| --- | --- | --- | --- | --- |
| Mark | no record | active current document; caller may write metadata | PROPOSED, no accepted revision | CREATED |
| Accept | PROPOSED | expected current revision matches | ACCEPTED, accepted_revision_id = current | ACCEPTED |
| Reaffirm | ACCEPTED with drift | expected revision = current; different from accepted | ACCEPTED, update accepted_revision_id | REAFFIRMED |
| Supersede | ACCEPTED | replacement is same-workspace ACCEPTED and not drifted; both active; no cycle | SUPERSEDED, accepted revision remains historical | SUPERSEDED |

No transition is defined out of SUPERSEDED, nor ACCEPTED -> PROPOSED. There is no Reject state in MVP. A stale Accepted decision is still Accepted, but the UI and list must not claim its *current* content was accepted.

Define current revision as the current **revision ID** on the document, not a timestamp, hash, Markdown heading, or stored path. For an ACCEPTED decision:

- accepted_revision_id == document.current_revision_id: verified accepted content for this workflow.
- accepted_revision_id != document.current_revision_id: Needs Review.

For SUPERSEDED, show the historical accepted revision even if the document later changes; never present the new revision as the authoritative superseded content. This workflow's Accepted state is **decision approval**, not the separate Knowledge Verification feature; do not reuse another feature's badge or approval authority.

Marking/accepting/reaffirming are explicit user actions: a sync, rename, restore, or Markdown/frontmatter edit must never generate decision approval events. An unchanged-content sync that creates no new revision does not create drift. A Hub editor “restore revision” operation may create a new current revision: drift is revision-ID-based even if text equals earlier accepted content; explicit reaffirm is still needed.

## 7. Persistence contracts

### 7.1 decision_records (Hub-owned authoritative metadata)

| Column | Shape | Contract |
| --- | --- | --- |
| document_id | UUID primary key, FK knowledge_documents(id) | One decision record per stable document |
| status | ASCII enum/check string | PROPOSED / ACCEPTED / SUPERSEDED |
| accepted_revision_id | nullable UUID | Composite FK (document_id, accepted_revision_id) -> knowledge_revisions(document_id,id) |
| superseded_by_document_id | nullable UUID | FK decision_records(document_id); replacement is a Decision |
| state_version | unsigned integer, initially 1 | CAS guard on concurrent state changes |
| created_by / updated_by | UUID FK users(id) | Auditable trusted actor |
| created_at / updated_at | DATETIME(6) | State change times |

Database shape constraint:
- PROPOSED: accepted_revision_id NULL, superseded_by_document_id NULL.
- ACCEPTED: accepted_revision_id NOT NULL, superseded_by_document_id NULL.
- SUPERSEDED: accepted_revision_id NOT NULL, superseded_by_document_id NOT NULL.
- superseded_by_document_id != document_id.
- Cycles and target eligibility require application validation under locks; FK/CHECK alone are insufficient.

Do not copy workspace_id, source_id, path, title or current revision into decision_records. Derive workspace and title using the present Document -> Source -> Workspace join, and derive drift against the current KnowledgeDocument row.

Recommended indexes: status + updated_at, superseded_by_document_id, accepted_revision_id (plus the primary key). List queries must scope through joined Source/Workspace before filtering/search.

### 7.2 decision_events (append-only ledger)

| Column | Shape | Contract |
| --- | --- | --- |
| id | UUIDv7 primary key | Stable event identity |
| document_id | UUID FK decision_records(document_id) | Owning decision |
| type | CREATED / ACCEPTED / REAFFIRMED / SUPERSEDED | Explicit intent |
| before_status / after_status | nullable/status | CREATED has null before |
| revision_id | UUID NOT NULL | Revision observed when event committed, composite FK with document_id |
| before_state_version / after_state_version | nullable/unsigned | CREATED is null -> 1, subsequent +1 |
| related_document_id | nullable UUID FK decision_records(document_id) | Non-null only for SUPERSEDED |
| actor_id | UUID FK users(id) | Trusted actor |
| created_at | DATETIME(6) | Event timestamp |

Retain events permanently under existing soft-archive semantics. Events are append-only with no update/delete repository method; a business-state mutation and its exactly one corresponding event are committed in one DB transaction. For SUPERSEDED the event's revision_id is the superseded decision's last accepted revision, not necessarily its current content revision.

Require the same-document composite FK for revision_id to prevent attaching another document's content. Use monotonic state_version as the user-visible concurrency token. Apply status-shape checks with MariaDB 10.11-compatible constraints. Avoid a new Decision ID: the document ID is canonical.

No migration writes historical markdown, fabricates approvals or backfills decisions. An additive migration creates empty tables; deployment of old application code leaves those tables harmless. An actual migration number is chosen after inspecting the latest main at implementation time.

## 8. Transaction sequencing and race handling

Every state mutation runs through the Knowledge application service and a MariaDB unit of work. The service obtains a trusted caller, resolves the document's Source/Workspace without relying on route-supplied scope, then acquires locks and **revalidates everything inside the transaction**.

Preserve the existing lock ordering: Source row(s) first, then Workspace, then Document(s), then DecisionRecord(s); for multiple Sources/Documents, acquire by stable ascending ID. Re-read eligibility, memberships/effective capabilities and Source/Document ACTIVE status after locking. This prevents source archives or syncs from racing decisions and maintains the repository's Source -> Workspace -> deeper convention; do not reverse it in a new route. Reuse existing lock/access helpers where feasible and add only the targeted Source lock port needed.

Write calls carry **expectedRevisionId** and **expectedStateVersion** (mark uses expectedRevisionId and an absent-record precondition); validate both against the locked current state. On mismatch return **409 DECISION_CONFLICT** or **409 STALE_DOCUMENT_REVISION**, with refresh guidance and no event. Two concurrent Accept requests cannot both create approvals. Non-repeatable mutations never implicitly retry on a different revision. Marking twice returns an already-exists conflict; refreshing shows the existing record.

Supersede is one atomic transaction; lock original and replacement decisions, require same workspace and an Accepted, non-drifted replacement, refuse target == original and cycles. Because MVP allows only a terminal superseded state and the target must currently be Accepted, graph cycles should also be detected explicitly for integrity against legacy/corrupt data. A supersede action does not change the replacement decision. Replacement target becoming archived later leaves historical relation intact; read views show an “unavailable/archived decision” placeholder rather than inventing a new target.

An accepted decision being edited or synced at the same time must either be based on the revision checked inside the transaction or fail with 409; never accept a future unseen version. Decision writes do not create content revisions or trigger link-index rewrites.

## 9. Authorization and visibility

Read/list/detail require authenticated caller and current Workspace membership and document.read. Mutation requires document.write in the document's Workspace (VIEWER cannot mark/accept/reaffirm/supersede; EDITOR/ADMIN/OWNER can). This is a **Hub metadata capability**, not permission to modify SOURCE_MANAGED content. Use the same workspace mutation locks and production trusted identity provider. No special permission derives from group org_code or merely knowing a decision/document ID.

Both sides of a Superseded link must be visible in the same workspace, even on reads. A missing, inaccessible, wrong-workspace or archived target is displayed generically without leaking names/existence. Non-discoverable resources return non-enumerating 404 per the existing resource-visibility rules; authenticated-but-insufficient permission uses the established 403 branch where discover is granted. Missing caller is 401 and unavailable identity infrastructure is 503 under existing conventions. Validation errors use existing client-validation conventions; do not add ad hoc HTTP error semantics.

A public document share token does **not** grant Decision list/detail APIs, event history, target resolutions, unrelated document revisions, AI search or MCP. The anonymous shared page continues to show its existing Markdown body, but no new status badge or resolved Decision link that would expand token authority. Signed-in review via share token does not elevate Decision permissions.

## 10. Application ports and API contract

Add a focused DecisionRecordService and DecisionRecordRepository / DecisionEventRepository within src/modules/knowledge. Keep domain state-validation rules pure; persistence behind ports; wire MariaDB adapters through the existing unit of work and composition root. Reuse knowledge query authorization and existing reader projection patterns rather than creating a second policy stack.

Proposed app operations:

~~~ts
markDecision(caller, { documentId, expectedRevisionId })
acceptDecision(caller, { documentId, expectedRevisionId, expectedStateVersion })
reaffirmDecision(caller, { documentId, expectedRevisionId, expectedStateVersion })
supersedeDecision(caller, {
  documentId, replacementDocumentId,
  expectedRevisionId, expectedStateVersion,
  expectedReplacementRevisionId, expectedReplacementStateVersion
})
getDecision(caller, documentId)
listDecisions(caller, { workspaceId, query?, status?, needsReview?, cursor?, limit? })
listDecisionEvents(caller, documentId, { cursor?, limit? })
~~~

Proposed HTTP surfaces, all trusted-caller only:
- GET /api/workspaces/:workspaceId/decisions
- POST /api/decisions (mark an existing document)
- GET /api/decisions/:documentId
- GET /api/decisions/:documentId/events
- POST /api/decisions/:documentId/accept
- POST /api/decisions/:documentId/reaffirm
- POST /api/decisions/:documentId/supersede

All writes validate input server-side, with explicit maximum lengths/bounded pagination. The list supports only same-workspace ACTIVE documents/sources by default, stable sort by last status update descending then document ID, and a bounded next-cursor to avoid unbounded workspace scans. Search in MVP is keyword title matching via the current Knowledge Revision title, not a new full-text index. The query response includes only readable titles, status, drift, source label and summary metadata; do not return whole Markdown.

Suggested error codes: DECISION_NOT_FOUND (non-enumerating 404), DECISION_ALREADY_EXISTS (409), DECISION_CONFLICT (409), STALE_DOCUMENT_REVISION (409), INVALID_DECISION_TRANSITION (409), INVALID_DECISION_REPLACEMENT (400/409 per stable domain error mapping). Extend the centralized error mapper and test exact status/codes. Never use a generic 500 for expected invalid input.

## 11. UI integration

- Add a **Decisions** entry to Workspace navigation, including My Space. The route /w/:workspaceId/decisions follows current shell, responsive typography, lists and empty-state conventions from frontend-design-language.md; no new design tokens.
- Add **Mark as Decision** to existing reader actions when the caller can write metadata and the active document has no record.
- For recorded decisions, render a small status header, accepted/current revision comparison and links to details/history; avoid a second Markdown editor.
- **Accept** and **Reaffirm** controls include a confirmation naming the exact revision; **Supersede** requires an explicit searchable same-workspace replacement and confirmation before mutation.
- Show loading, permission-loss, stale-version and missing-replacement states. On 409 reload, do not silently resubmit.
- The Decisions list has status tabs plus Needs Review toggle, Source label, title and last state time. Responsive/mobile UI remains readable.
- New Decision opens existing new-document flow prefilled with the Markdown template, then marks it after save. If the current workspace has no editable HUB_MANAGED source, guide the user to create one or mark an existing synced note instead; do not create editable content in a SOURCE_MANAGED source.
- Update in-app user guide in English and zh-TW and the README feature section once the functionality actually ships.

## 12. Folder sync, revisions and links

Folder sync changes a document's immutable current revision but **does not write decision_records/events**. Drift is calculated at query time, so there is no background job, hook or sync-index consistency burden. A rename/move is identity-preserving only when the existing import reconciliation retains the document ID; a mismatched replacement document receives no automatically inherited decision metadata. SOURCE_MANAGED Markdown remains untouched.

A Document archive/restore does not delete a decision record, its events or related target; ordinary Decisions browsing excludes archived documents until restored. Restoration preserves status and historic accepted revision, with drift calculated normally. Decisions in archived Sources are likewise unavailable to normal browsing. No hard deletes.

Wikilinks and relative Markdown links keep using the existing link index/backlink rules; superseded_by_document_id is an **authoritative, typed relation** independent of that rebuildable index. MVP shows it on the reader but does not modify the graph renderer/index. A later typed-edge view can consume the relationship through the same workspace authorization checks.

## 13. Security, performance and operations

- Source path/title/frontmatter and link resolution cannot be used as cross-workspace existence oracles.
- Read operations filter scope before response projection; do not reveal opaque inaccessible targets via counts, metadata, error details or share pages.
- State changes are audited through append-only decision_events with actor and transaction timestamp; preserve existing workspace governance audit discipline.
- Use indexed bounded pagination for lists/events; avoid N+1 document title queries. No semantic embeddings, network extraction or worker.
- All schema changes additive and forward-only; schema baseline is verified from main at implementation time. Re-running deployment must not seed decisions from file contents.
- Follow the existing migration runner, MariaDB 10.11 constraints, UUID type and stable document ID contracts.
- The feature can be disabled at UI-entry level for rollout only if the resulting already-stored record remains query-safe; no silent loss of history.

## 14. Acceptance tests and verification

**Domain/unit**:
1. All allowed/forbidden state transitions; no reaccept/reaffirm of SUPERSEDED.
2. Needs Review derives exclusively from accepted_revision_id versus current_revision_id for Accepted.
3. Reaffirm changes the accepted pointer and appends one event, never content.
4. Accept/reaffirm reject stale revisions; no duplicate events under CAS conflict.
5. Cross-workspace, self, nonaccepted, drifted, archived and cyclic supersede targets fail.
6. Frontmatter “Accepted” does not grant approved status; template parsing does not gate marking.

**MariaDB integration**:
7. PK/FKs/composite same-document revision FK/status-shape constraints and event append-only behavior.
8. State/event atomicity on success and injected failure; deterministic concurrent races.
9. Source sync creates a revision -> Needs Review; NOOP sync leaves it current; rename preserving document ID preserves decision.
10. Source/document archive and restore preserve history and normal visibility.
11. Source/Workspace/Document/Decision lock behavior has no unsafe inversion against import/apply and governance mutations.

**Authorization / E2E**:
12. My Space: create existing/source-managed decision, accept, sync, drift, reaffirm, supersede and history.
13. VIEWER reads but cannot mutate; EDITOR can; revoked membership fails under current grants.
14. Cross-workspace document ID cannot be listed, opened or linked; negative share-token and share-review cases.
15. Concurrent Editor personas produce one successful state transition and a 409 refresh path; trusted-caller 401 versus unavailable-provider 503 are distinguished.
16. Responsive EN/zh-TW UI and help entry; source-managed content remains read-only.
17. Run repository's unit/type/lint/build gate, isolated MariaDB integration, targeted Playwright E2E and relevant security guards.

## 15. Delivery slices after spec approval

Proposed implementation-plan split (not yet authorized):

1. **Domain and persistence**: state rules, two tables, repository ports, migrations, concurrency tests.
2. **Application APIs and security**: services, locks, authorization, HTTP routes, error mapping, API/integration coverage.
3. **Reader and Decisions listing**: navigation, UI/status, filtering, error states, E2E.
4. **Template and rollout**: new-note flow, bilingual help/README and final verification.

Each slice must reuse the existing architecture and preserve these gates. No separate Team Workspace dependency is introduced for Personal MVP, but all records are workspace-scoped from the beginning.

## 16. Design review decision

The conversational proposal selected architecture **B**. Review this written specification, particularly explicit Accepted-vs-Needs-Review behavior, one-way SUPERSEDED lifecycle, use of EDITOR write capability, and the exclusion of decision metadata from anonymous share tokens. These are proposed operational details, not approval to implement.

**Next gate:** user review of this committed design spec. Only after written-spec approval should Superpowers writing-plans produce a separate implementation plan.

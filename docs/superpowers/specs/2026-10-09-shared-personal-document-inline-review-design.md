# Shared personal document inline review — design specification

| Item | Decision |
| --- | --- |
| Date | 2026-10-09 |
| Status | **Proposed for review; not implemented** |
| Method | Superpowers-style brainstorming → design specification; writing-plans and execution follow review |
| Scope | My Space documents exposed through existing expiring/revocable share links |
| Baseline | 2026-09-23 document-share-link design, Phase 3 identity and Workspace access, Phase 5 revision model, frontend design language |
| Explicitly out of scope | System / Module hierarchy, Team Workspace collaboration, simultaneous Markdown editing, Git integration |

## 1. Problem and outcome

Knowledge Hub currently supports a one-document, anonymous, read-only share link. A designer or reviewer can read an AI-generated technical design, but feedback moves into chat or meetings. The original owner then has to reconstruct which paragraph the question refers to; important design rationale is lost.

**Outcome:** an owner shares a My Space document; colleagues open the same link, select a specific passage, sign in through a trusted company SSO session, and start a discussion in a right-hand comment rail. Other authenticated link holders see and reply to the discussion. The owner can respond, revise the source document (including re-sync of SOURCE_MANAGED folders), and resolve the thread. Nothing writes into the Markdown file.

This is *review and decision discussion*, not Google Docs-style concurrent text editing. It should also work for SOURCE_MANAGED content: the Hub stores review metadata separately and never claims it can edit an imported Markdown file.

## 2. Decisions and alternatives

| Question | Decision | Why / rejected alternative |
| --- | --- | --- |
| What ships first? | Personal document inline review | Adding System or Module now delays validation and alters information architecture. |
| Who can read the document? | Anyone with a valid existing share link, without login | Preserve established share-link behavior. |
| Who can read comments? | Valid link **plus authenticated Hub identity**; document owner also sees them inside their My Space | Names and review decisions should not become anonymous/public data by default. |
| Who can create threads or reply? | Authenticated user holding a currently valid share link, including the owner | No per-reviewer invitations or new Workspace membership model. |
| Can reviewers resolve a thread? | No; document owner resolves/reopens | Responsibility for the authoritative design stays with the owner. |
| What owns threads? | The **document ID**, not one link/token | Multiple links and later link rotation share one discussion history. |
| What happens when a link expires/revokes? | Access through that link stops, including comments; stored threads remain | Revocation removes the grant, not knowledge/audit history. |
| What happens after Folder Sync? | Threads survive revisions; anchor is re-evaluated and can become Outdated | Editing Markdown or relying on fixed line numbers is fragile. |
| Inline selection? | One supported rendered text block per new thread | Cross-block/complex rendered selections complicate reliable offsets. |
| Does this create Workspace access? | Never | A token + identity authorizes limited review, not membership, search, tree, history, authoring or MCP. |

**Alternatives considered:** link-scoped threads isolate audiences but fragment discussion when links are rotated; free-form document-level comments lose the exact passage; writing comments back into Markdown creates sync conflicts; System/Module-first architecture is too large for this MVP. A one-owner/many-reviewers asynchronous review workflow best matches the current product.

## 3. Scope and UX

### 3.1 Owner

1. Opens an existing My Space document and creates/copies an ordinary share link using the existing Share dialog.
2. The dialog warns: **"Anyone with this link can read this document. Signed-in reviewers with a valid link can see all review discussions for this document and add comments. Do not share a link with someone who should not see the discussion."**
3. The owner can open a Review panel on their authenticated My Space document page, independent of whether the original link later expires.
4. New threads, replies, and resolved/outdated state appear there. The owner replies, makes a change to the source through the existing editing/sync workflow, and explicitly marks a thread Resolved. Resolved threads can be reopened.

### 3.2 Reviewer

1. Opens /s/:token. Without signing in, the current Markdown is displayed as today; a **Review comments — Sign in** affordance appears but neither reviewer names nor comment bodies load.
2. Signing in returns to the same share link. Only a **server-validated** authenticated principal can retrieve threads.
3. After login, selecting text inside one eligible rendered text block shows **Comment**. Clicking it opens the right-hand rail with the quoted selection and composer.
4. Creating a thread shows author, timestamp, quote highlight, body, and Open state. Any other signed-in holder of a currently valid link to the same document can see and reply.
5. Selecting a highlight focuses its discussion; selecting a discussion scrolls/focuses its text when the anchor still matches. An Outdated thread remains accessible in the side rail.
6. On narrow screens, the rail is a drawer; keyboard and screen-reader users can invoke **Comment on selection** without requiring pointer hover.

**Scope of eligible blocks:** headings, paragraphs, list-item text, and blockquote paragraphs, including inline emphasis and inline code. v1 does not allow creating a thread across multiple blocks or on code fences, diagrams, tables, embedded media, or a collapsed/unrendered source range. Those content types remain readable. Explain the selection limitation unobtrusively; never silently attach it to a wrong block.

**No live collaboration requirement:** update on refresh or explicit Refresh discussions; optional polling can follow later. No notifications, mentions, assignments, comment editing/deletion, real-time cursors, or decision-record conversion in this release.

### 3.3 Comment lifecycle

Open → Resolved ↔ Open. **Outdated is a derived anchor state, not a destructive thread state**; an Outdated thread can still be Open or Resolved. A reply does not rewrite its original anchor. Threads are ordered by document position when matched, then by creation time; the side rail has Open / Resolved filters and an Outdated indicator.

## 4. Authorization and privacy contract

**Permission formula for link-based discussion:**

- Valid current link **AND** established trusted caller **AND** active single-document scope → list comment threads, create threads, reply.
- The linked document's PERSONAL Workspace owner, verified by authenticated caller and derived Document → Source → Workspace relationship → may additionally list, reply, resolve/reopen through owner-only document endpoints, even when no share link remains valid.
- Anonymous valid link → read the current document only; no comment bodies, author names, counts implying reviewers, or writes.
- Invalid/expired/revoked link → no linked read or review capability, whether logged in or not.

No implicit permissions from a browser-supplied employee ID, email, display name, org code, user ID, document ID, or link ID. Company deployments must use the configured Company SSO provider plus the server-side session reader and HubIdentityResolver. Local identity mode remains a development/test fixture only; no production fallback. A company-managed PC is **not** authentication by itself.

A link holder does not become a My Space member, cannot see the tree or other documents, and cannot use the token to call ordinary Workspace or revision APIs. The backend re-evaluates link validity, document/source/workspace lifecycle and issuer read access on **every** review read/write. An authorization check in the UI is never sufficient.

**Important intentional amendment:** CLAUDE.md and the 2026-09-23 share-link spec currently describe a share token as granting *only* anonymous read through one path, and never a write. This feature requires a **narrow new compound grant**: a valid token plus authenticated caller may write *review records only*. It does not authorize document/revision/content writes. The implementation PR must amend these canonical invariants and the share-link spec explicitly, not silently create an exception.

### 4.1 Privacy of historical quotes

The existing public share page reveals only the *current* document revision. Anchored threads reference older revisions, so returning their previous text could inadvertently reveal content removed by a later revision. The reviewer thread projection **must not expose historical exact quote/prefix/suffix when the anchor cannot be validated against the current revision**. It returns **Outdated selection** instead. The owner-side review may display old quotes because the owner already controls the document. Discussion text itself is authored review content and visible to all authenticated current link holders; the Share dialog must warn about this.

### 4.2 Account/login navigation

Keep /s/:token server-rendered and anonymous. Comment API operations establish a trusted caller separately and respond with a structured **401 AUTH_REQUIRED** when a session is absent, before attempting any write. If SSO integration is missing or untrusted, **fail closed** and do not convert it to a local identity. Preserve the browser's original first-party share-page destination across the sign-in flow, without embedding share tokens into third-party identity-provider callback parameters, logs, analytics, or outbound referrers. Only a same-origin allowlisted return path may be used.

### 4.3 Security controls

- All comment reads/writes: private, no-store responses; no token or comments in external telemetry, request logs, error reports, Open Graph, or page metadata.
- A comment mutation authenticated via cookies must enforce trusted Origin/CSRF checks and secure session-cookie protections; CORS is not an authorization substitute.
- Existing /s/:token no-referrer/noindex/CSP policy remains. Review endpoints are not cacheable.
- Escape/sanitize comment text as plain text (no arbitrary HTML, script or Markdown raw HTML). Limit body to 3,000 Unicode characters; no attachments.
- Limit to 200 threads per document, 100 replies per thread, and 30 new thread/reply writes per user per hour per document; enforce server-side and return 429 for rate limits. Specify storage-backed enforcement in implementation plan rather than in-memory limits on horizontally scaled instances.
- Do not use share tokens as persistent reviewer grants: each request supplies a live token, which is checked again.

## 5. Data model (MariaDB additive migration)

Use the **next available migration version**, not a hard-coded number without checking main. Extend Knowledge module domain/ports/application/MariaDB adapter; preserve repository import boundaries.

### review_threads

- id UUIDv7 PRIMARY KEY
- document_id UUID FK knowledge_documents, NOT NULL (scope is derived from document/source; do not duplicate workspace_id)
- created_revision_id UUID FK document revisions, NOT NULL
- created_by UUID FK users, NOT NULL
- origin_share_link_id UUID FK document_share_links, NULL (audit provenance only; **not** the authorization or visibility boundary)
- anchor_json JSON NOT NULL, schemaVersion=1
- status ENUM('OPEN','RESOLVED') NOT NULL DEFAULT 'OPEN'
- resolved_by UUID FK users NULL; resolved_at DATETIME(6) NULL
- created_at DATETIME(6) NOT NULL
- updated_at DATETIME(6) NOT NULL
- indexes (document_id, status, created_at), (created_by, created_at)
- DB CHECK constraints for resolution consistency where supported

### review_comments

- id UUIDv7 PRIMARY KEY
- thread_id UUID FK review_threads NOT NULL
- author_user_id UUID FK users NOT NULL
- body TEXT NOT NULL (application validates 1–3,000 chars)
- created_at DATETIME(6) NOT NULL
- idempotency_key VARCHAR(64) NOT NULL; UNIQUE(thread_id, author_user_id, idempotency_key)
- index (thread_id, created_at, id)

The initial message is the first review_comments row in the new thread, in the **same transaction**. Owner resolution creates an audit event with actor/time. No hard delete of review history in v1; this matches current document/link lifecycle conventions. Employee names are read from stored Hub users for display and never trusted from client payloads.

## 6. Anchoring and revisions

### 6.1 Anchor persisted at creation

Persist versioned anchor data:

~~~json
{
  "schemaVersion": 1,
  "revisionId": "<UUID>",
  "blockPath": [4, 1],
  "blockKind": "paragraph",
  "startUtf16": 15,
  "endUtf16": 58,
  "exact": "the selected visible text",
  "prefix": "up to 64 visible characters immediately before",
  "suffix": "up to 64 visible characters immediately after"
}
~~~

The block path is deterministic under the Markdown AST and the product's selected remark transforms, not a DOM selector, HTML ID, visual line number or screen coordinate. Start/end use UTF-16 offsets against a canonical rendered-visible-text projection of one eligible block, so JavaScript selections and server validation agree. Inline formatting nodes are concatenated in reading order; normalize line endings/whitespace consistently, and document/test the exact canonicalizer. Cap the exact quote at 512 characters and the context at 64 characters each.

**Creation must validate against the stored specified revision server-side**: revision belongs to this document, it is still current at commit, the block and offset range exist, and the server-computed exact/prefix/suffix agree. Never accept arbitrary client-selected text as authoritative. Add revisionId to the share page's current-document projection, without adding history or cross-document identifiers to the public page.

### 6.2 Re-anchoring after owner edit or Folder Sync

At read time, if revision ID equals current: validate the original range directly. If newer:

1. Find a unique, exact visible-text match within the corresponding semantic section/block neighborhood, using context.
2. If unique with consistent context, show it attached to the new position and report match status **MOVED**; do **not** modify the original stored anchor.
3. If missing, ambiguous, block semantics changed substantially, or matching budget exceeded, show **OUTDATED** without an inline highlight or an old quote to reviewers.
4. Never silently attach a comment to a different occurrence of the same generic phrase.

Resolve/reply actions still work for Outdated threads; owner can address the thread based on context and mark it Resolved. No auto-resolve on document change. Re-anchoring is computed from the **current revision only** for reviewer responses; it must not send previous Markdown/revision content to link holders.

Bound remapping work by rendered block count/characters and return OUTDATED rather than running expensive unbounded full-document scans. Cache only within one request; no cross-request publication of historical anchors.

### 6.3 Concurrent sync/comment creation

If Folder Sync or owner edit advances current_revision_id between selection and POST, reject creation with **409 STALE_DOCUMENT_REVISION** and return a refresh/reselect instruction. Do not try to guess or write against a stale source. Replying to an existing Open/Outdated thread can proceed after a newer revision as long as the link remains valid. Review comments must not modify Markdown, source snapshots, imports, document revisions, or the link index.

## 7. API boundaries (proposed)

Share tokens for comment APIs are in an HTTPS **JSON request body**, not new GET query parameters. Never construct absolute links from untrusted Host headers.

| Method | Path | Auth & behavior |
| --- | --- | --- |
| POST | /api/share-review/threads/query | Authenticated + valid token in JSON body. Returns bounded threads/comments for **one** document with safe current-revision anchor projections. |
| POST | /api/share-review/threads | Authenticated + valid token. Creates thread + first comment; requires expectedRevisionId, selected anchor, body, idempotency key. |
| POST | /api/share-review/threads/{threadId}/replies | Authenticated + valid token. Resolves thread-to-document and verifies token covers the *same* document; appends reply to Open thread. |
| GET | /api/documents/{documentId}/review-threads | Authenticated document owner through normal Workspace authorization. May view history/anchor quote. |
| POST | /api/documents/{documentId}/review-threads/{threadId}/replies | Authenticated owner only. Append reply without needing a share link. |
| POST | /api/documents/{documentId}/review-threads/{threadId}/resolution | Authenticated owner only. status=OPEN or RESOLVED; idempotent updates and audit. |

The list endpoint is POST to avoid putting the bearer token in a URL; this is a deliberate read-via-POST exception. The public share page can remain a Server Component, with a small client-side review island loaded after authentication. No implicit call to Workspace APIs from anonymous /s/:token.

Authentication status for review endpoints: 401 (not signed in), 404 uniform (invalid/inaccessible link/document/thread without revealing existence), 400 (invalid input/selection), 409 (stale revision or resolved thread reply), 429 (quota), 503 (trusted SSO integration unavailable), and 5xx generic for unexpected failures. Existing anonymous share-link route keeps uniform 404. Never return different error messages revealing why a token is invalid.

**Transaction and locking:** follow existing share revocation lock order to prevent a post-revocation write from committing: lock link row first for link-based mutations, then source, then shared Workspace lock and relevant thread, revalidating lifecycle/issuer access *after* locks. No Workspace owner membership is granted to reviewer. A revoke waits for in-flight comment mutation, or mutation sees revoked state and fails. Owner-only thread writes use Source → Workspace → Thread; do not invert these locks in any new path. Keep MariaDB READ COMMITTED semantics and integrate with the existing UnitOfWork pattern. Add idempotency on retries so a flaky connection cannot duplicate a reply.

## 8. Implementation boundaries

- **Domain:** ReviewThread, ReviewComment, anchor validator/remapper and review authorization policy in Knowledge module.
- **Ports:** review-thread repository, comment repository, existing share-link and revision readers, audit writer.
- **Application:** distinct ReviewService use cases for token+caller and owner+caller. Do not overload the caller-less DocumentShareService.readShared with comment writes.
- **Infrastructure:** additive MariaDB migration and repository adapters, registered through UnitOfWork/composition.
- **Server:** focused review API handlers using trusted identity resolution, consistent HTTP errors, Origin/CSRF checks and no-store.
- **UI:** new client-only SharedReviewPanel adjacent to MarkdownRenderer; owner document review panel using shared thread components. Keep light/dark tokens and keyboard focus behavior from frontend-design-language.md.
- **Canonical docs:** explicitly amend 2026-09-23 share-link design and CLAUDE.md's "single bearer grant / never any write" invariant **in the implementation PR**; this proposed spec records the intended exception and must be approved before code.

No System or Module model, Team Workspace write access, external collaborative editor, Git source connection, notification bus, or publishing workflow is required.

## 9. Acceptance criteria and required tests

1. **Anonymous unchanged:** a valid /s/:token opens current Markdown without SSO, and anonymous attempts to query/create/reply to comments get no comment data and cannot write.
2. **SSO provenance:** signed-in reviewer from trusted claims can post; submitted employee/user/author fields are ignored or rejected; a missing/untrusted Company SSO session cannot post (including production fail-closed).
3. **One document scope:** a valid token for Document A cannot query, reply to, or change a thread on Document B, even with guessed UUIDs. A link provides no access to owner Workspace tree/search/history/MCP/other documents.
4. **Multi-link collaboration:** two different valid links to the same document show the same threads to authenticated users; revoking one removes its holders' review access but does not erase threads for the other link or owner.
5. **Owner controls:** only document owner can resolve/reopen and access the owner-only comments endpoint; owner can review after every link expires.
6. **Sync-safe:** SOURCE_MANAGED Folder Sync changes source Markdown; comments remain in DB; no diff or import conflicts attributable to review data; unchanged quotes re-anchor and missing/ambiguous quotes become Outdated without mis-highlighting.
7. **Stale safety:** a client POST with a superseded revision fails 409; same idempotency key retried after response loss creates one comment.
8. **History/privacy:** outdated reviewer payload never includes older exact quote/prefix/suffix or old Markdown, while owner retains enough provenance to triage.
9. **Security:** invalid/expired/revoked/archived links uniformly deny; CSRF/origin, no-store, token log redaction, rate limits and escaping are tested.
10. **UX/accessibility:** pointer and keyboard selection, focus/scroll between highlight and thread, reply/resolve states, mobile drawer, and screen-reader announcement pass E2E.
11. **CI:** unit tests (authorization/anchors), integration (MariaDB transaction/revoke race), E2E (anonymous→SSO review→owner resolve→sync→outdated), typecheck, lint, build and current repository regression gates pass.

## 10. Implementation order after design approval

1. **writing-plans:** produce a task-by-task plan in docs/superpowers/plans, with migration rollback/roll-forward notes and file-level test steps.
2. **Backend foundation:** domain/ports, migration, repository tests, capability/identity/CSRF boundary.
3. **Read and write API:** idempotency, link-revoke race, owner-only endpoints, error mapping.
4. **Anchoring:** text-projection contract, selection validation, safe read-time remapping, stale handling.
5. **UX:** share reader sidebar and owner review panel, E2E accessibility/SSO flows.
6. **Documentation & verification:** update canonical invariants, run full gates, record real verification results in docs/superpowers/verification.

## 11. Open implementation details (not blockers for the product decision)

- Determine the production-approved SSO sign-in initiation / return URL from the existing company gateway; do not invent a client-side provider bypass.
- Pin the exact AST-visible-text canonicalization and block identity implementation with round-trip tests before accepting real anchors.
- Choose an existing distributed/shared rate limiter or a MariaDB rate-limit ledger consistent with internal deployment needs.
- Confirm layout placement and responsive styling through screenshots after the implementation branch exists.

**Recommendation:** approve this document-scoped, SSO-gated, link-based inline review design; next produce the writing-plans checklist. Implement System and Module ownership only after this personal-share review loop is validated.

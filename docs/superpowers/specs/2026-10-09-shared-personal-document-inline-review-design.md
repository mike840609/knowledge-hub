# Shared personal document inline review — design specification

| Item | Decision |
| --- | --- |
| Date | 2026-10-09 |
| Status | **Revised design for review; feature not implemented** |
| Plan | Pending Superpowers `writing-plans` after spec approval |
| Verification | Pending implementation and independent test evidence |
| Method | Superpowers-style brainstorming → design specification; writing-plans and execution follow review |
| Scope | My Space documents exposed through existing expiring/revocable share links |
| Baseline | 2026-09-23 document-share-link design, Phase 3 identity and Workspace access, Phase 5 revision model, frontend design language |
| Explicitly out of scope | System / Module hierarchy, Team Workspace collaboration, simultaneous Markdown editing, Git integration |
| Company SSO integration | **Deferred to the company's internal environment.** Reuse the trusted identity/session interface; no OAuth callback, IdP integration or fake production login in this scope. |

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
| Can reviewers resolve a thread? | No; document owner resolves/reopens | Responsibility for authoritative design stays with the owner; replies to resolved threads require reopening. |
| Can harmful content be hidden? | Owner can hide a thread or an individual comment, with an audit trail | Sensitive mistakes and spam must not remain visible to link holders. |
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
4. New threads, replies, and resolved/outdated state appear there. The owner replies, changes the source via the existing editing/sync workflow, and explicitly marks a thread Resolved; reopening is owner-only. The owner may also **Hide thread** or **Hide comment** with a confirmation; this hides the content from all reviewers without modifying Markdown or deleting the audit record.

### 3.2 Reviewer

1. Opens /s/:token. Without signing in, the current Markdown is displayed as today; a **Review comments — Sign in** affordance appears but neither reviewer names nor comment bodies load.
2. **When the company's SSO entry point is configured**, signing in returns to the same share link; only a **server-validated** authenticated principal can retrieve threads. Until then, production remains read-only for reviewers: no broken sign-in link or local-account fallback. Local development may use the repository's existing local identity test mode, clearly labelled development-only.
3. After login, selecting text inside one eligible rendered text block shows **Comment**. Clicking it opens the right-hand rail with the quoted selection and composer.
4. Creating a thread shows author, timestamp, quote highlight, body, and Open state. Any other signed-in holder of a currently valid link to the same document can see and reply.
5. Selecting a highlight focuses its discussion; selecting a discussion scrolls/focuses its text when the anchor still matches. An Outdated thread remains accessible in the side rail.
6. On narrow screens, the rail is a drawer; keyboard and screen-reader users can invoke **Comment on selection** without requiring pointer hover. A hidden thread disappears from reviewer results; a hidden individual comment is shown as **Comment hidden by document owner** with no original body or quote. Reviewers cannot hide/unhide content.

**Scope of eligible blocks:** headings, paragraphs, list-item text, and blockquote paragraphs, including inline emphasis and inline code. v1 does not allow creating a thread across multiple blocks or on code fences, diagrams, tables, embedded media, or a collapsed/unrendered source range. Those content types remain readable. Explain the selection limitation unobtrusively; never silently attach it to a wrong block.

**No live collaboration requirement:** update on refresh or explicit Refresh discussions; optional polling can follow later. No notifications, mentions, assignments, comment editing/deletion, real-time cursors, or decision-record conversion in this release.

### 3.3 Comment lifecycle

Open → Resolved ↔ Open. **Outdated is a derived anchor state, not a destructive thread state**; an Outdated thread can still be Open or Resolved. **Neither owner nor reviewer may reply to a Resolved thread**: owner must Reopen first; a reviewer who disagrees can start a fresh anchored discussion while allowed, but cannot reopen the original. A reply does not rewrite its original anchor. Moderation visibility (`VISIBLE` / `HIDDEN`) is independent of resolution and anchor state; only the owner may hide or unhide. Threads are ordered by document position when matched, then by creation time; the rail has Open / Resolved filters and an Outdated indicator.

## 4. Authorization and privacy contract

**Permission formula for link-based discussion:**

- Valid current link **AND** established trusted caller **AND** active single-document scope → list comment threads, create threads, reply.
- The linked document's PERSONAL Workspace owner, verified by authenticated caller and derived Document → Source → Workspace relationship → may additionally list, reply, resolve/reopen through owner-only document endpoints, even when no share link remains valid.
- Anonymous valid link → read the current document only; no comment bodies, author names, counts implying reviewers, or writes.
- Invalid/expired/revoked link → no linked read or review capability, whether logged in or not.

No implicit permissions from a browser-supplied employee ID, email, display name, org code, user ID, document ID, or link ID. Company deployments must use the configured Company SSO provider plus the server-side session reader and HubIdentityResolver. Local identity mode remains a development/test fixture only; no production fallback. A company-managed PC is **not** authentication by itself. **Company-specific SSO login/callback integration is intentionally deferred**; this design defines the boundary without claiming enterprise login works today.

A link holder does not become a My Space member, cannot see the tree or other documents, and cannot use the token to call ordinary Workspace or revision APIs. The backend re-evaluates link validity, document/source/workspace lifecycle and issuer read access on **every** review read/write. An authorization check in the UI is never sufficient.

**Important intentional amendment:** CLAUDE.md and the 2026-09-23 share-link spec currently describe a share token as granting *only* anonymous read through one path, and never a write. This feature requires a **narrow new compound grant**: a valid token plus authenticated caller may write *review records only*. It does not authorize document/revision/content writes. The implementation PR must amend these canonical invariants and the share-link spec explicitly, not silently create an exception.

### 4.1 Privacy of historical quotes

The existing public share page reveals only the *current* document revision. Anchored threads reference older revisions, so returning their previous text could inadvertently reveal content removed by a later revision. The reviewer thread projection **must not expose historical exact quote/prefix/suffix when the anchor cannot be validated against the current revision**. It returns **Outdated selection** instead. The owner-side review may display old quotes because the owner already controls the document. Discussion text itself is authored review content and visible to all authenticated current link holders **until hidden by the owner**; the Share dialog must warn about this. Neither hidden comment bodies nor hidden thread content may be serialized into the reviewer payload, even in metadata, counts, previews or historical quotes.

### 4.2 Account/login navigation

Keep `/s/:token` server-rendered and anonymous. **The `401 AUTH_REQUIRED` JSON contract applies only when the Gateway forwards requests to the review API (§4.5); it is not an automatic consequence of keeping other app routes SSO-protected.** The configured Gateway must not turn review XHR/fetch calls into a `302` HTML IdP redirect. Review API handlers establish trusted callers and fail closed if SSO is missing/untrusted. Login initiation and return follow the nonce-based, same-origin flow in §4.5. Share tokens must never appear in IdP callback parameters, external redirect locations, logs or telemetry.

### 4.3 Security controls

- All comment reads/writes: private, no-store responses; no token or comments in external telemetry, request logs, error reports, Open Graph, or page metadata.
- A comment mutation authenticated via cookies must enforce trusted Origin/CSRF checks and secure session-cookie protections; CORS is not an authorization substitute.
- Existing /s/:token no-referrer/noindex/CSP policy remains. Review endpoints are not cacheable.
- Escape/sanitize comment text as plain text (no arbitrary HTML, script or Markdown raw HTML). Limit body to 3,000 Unicode characters; no attachments.
- Limit to **200 VISIBLE threads per document**, **20 VISIBLE OPEN threads per creating user per document**, 100 replies per thread, and 30 thread/reply writes per user per hour per document. Hiding a thread frees its visible-thread capacity, but does not erase the historical row. Quotas and rate limits need transactional/storage-backed enforcement across instances (not an in-memory counter), with 429 on rate exhaustion; return a distinct 409 for document capacity reached. A global/emergency review-write disable switch is required for abuse containment. These are abuse mitigations, not promises that no spam can occur.
- Do not use share tokens as persistent reviewer grants: each request supplies a live token, which is checked again.

### 4.4 SSO adapter boundary and staged delivery (decided)

**This is a design specification, not an SSO implementation.** The repository already defines `CompanySsoSessionReader`, `configureCompanySsoSessionReader`, `createIdentityProvider`, `HubIdentityResolver`, and `establishTrustedCaller`. It does **not** ship a company OAuth/OIDC login UI, callback endpoint, or deployed SSO gateway. Review services must consume the existing trusted `CallerContext`, not invent a parallel identity abstraction.

1. **Review-feature implementation:** build review services around `CallerContext`. Provide a server-derived login capability/return-navigation interface for the UI; if no trusted company login entry is available, keep the anonymous reader working and explain that comments require configured sign-in. No hard-coded IdP URL, browser-provided employee ID, fake production login or untrusted bypass.
2. **Development and CI:** use existing explicitly enabled local identity mode or injected `CompanySsoSessionReader` test doubles to exercise two real distinct Hub users, authorization and errors. A simulated principal verifies only the **interface**, never a deployed corporate sign-in. Test fixtures must not become a production authentication path.
3. **Later company integration:** an authorized deployer implements corporate sign-in initiation/return and a verified server-side session reader using corporate issuer/audience/expiry and trusted-session validation as applicable. Map verified claims through `HubIdentityResolver`. Restore only an allowlisted same-origin `/s/:token` destination; never leak bearer tokens into IdP URLs, external analytics, logs or unsafe provider state.
4. **Fail closed:** when the corporate identity reader is unconfigured/untrusted/unavailable, review operations requiring identity do not run. Do not use local identity as fallback. An absent user session is 401 `AUTH_REQUIRED`; an unavailable trusted provider/session integration is 503 `AUTH_UNAVAILABLE`. Neither leaks document/link existence.
5. **Separate release gates:** core review/API/test-suite acceptance can pass with deterministic trusted test callers before internal deployment. Production enablement and live corporate end-to-end sign-in/return acceptance are **deferred** until the gateway and session integration satisfy §4.5 and are tested on the company network.
6. **Bootstrap side effect:** the existing `establishTrustedCaller` creates/updates the reviewer Hub user and ensures their own PERSONAL My Space on first trusted request (`src/server/trusted-caller.ts`). This is accepted for MVP; no membership in the document owner's My Space is created. Capacity, onboarding, and identity-retention consequences belong in operations notes.

The eventual SSO provider may change, but the policy does not: **valid current share link + server-verified caller** on every reviewer request.

### 4.5 Gateway and login-return deployment contract (required design; company implementation deferred)

**Selected deployment model:** preserve public `GET /s/*` and `/_next/static/*` as currently designed. The Gateway must **forward only the exact review API prefix** `/api/share-review/*` to the application *without automatic interactive login redirects*, so the application can return JSON 401/403/404/503 and enforce both a trusted session and a valid share token. This is a narrow route exception, **not** anonymous permission to read/write comments: every review endpoint enforces identity, link scope, CSRF/Origin and current lifecycle server-side. Disallow CORS for cross-origin review requests; restrict methods and content types. Do not permit anonymous forwarding of all `/api/*` or `/auth/*`. Existing ordinary API routes keep their current Gateway protection. If company Gateway cannot support this model, corporate rollout is **blocked** until a separately reviewed XHR-safe 401 adapter is implemented and end-to-end tested; silently allowing 302-to-IdP for fetch is not an option.

**Same-origin sign-in handshake, future company integration:**

1. From an anonymous shared page, click **Sign in to comment**. A same-origin `POST /auth/review/start` (the **only** anonymously forwarded authentication-initiation route, enabled **only after** company integration) supplies the live share token in the body. The server verifies the token, applies Origin/CSRF and abuse controls, stores a short-lived opaque nonce mapping to the allowlisted **same-origin** `/s/:token` return destination in a server-side datastore (TTL at most 5 minutes; single use), and binds the nonce to that browser using an HttpOnly, Secure, SameSite=Lax first-party cookie. Do not put token or original path in IdP state, query parameters or provider redirect URI.
2. Server returns a `303` to the **Gateway-protected** same-origin `/auth/review/continue?n=<opaque-nonce>`. The Gateway may direct the browser to the corporate IdP because this is a top-level navigation. IdP/Gateway sees at most the opaque nonce, **never the share token**; `n` is not sufficient without the browser-binding cookie. A safe authentication relay may encode this nonce, but not the original token-bearing path.
3. Following corporate sign-in, the protected continuation validates the **server-verified** caller, nonce, cookie binding, TTL and single-use state; consumes the nonce and returns a **same-origin** `303` to the saved `/s/:token`, with `Referrer-Policy: no-referrer` and no-store. Clear the temporary cookie. A failed/expired nonce gives a neutral restart page; do not redirect to arbitrary input or disclose token content. Sanitized Gateway logs must mask `/s/*` paths and never log request bodies, auth cookies or stored return destinations.
4. On `/s/:token`, the client explicitly checks the review API response. A 401 JSON prompts sign-in only if a server-declared **reviewLoginAvailable** capability is true; 503 or unconfigured SSO shows **Comments require company sign-in, currently unavailable**. A redirected, cross-origin, non-JSON or HTML response is treated as `AUTH_GATEWAY_MISCONFIGURED`, never parsed as comment data and never followed as a background login flow. Route exceptions and browser cookies must work through the real Gateway, not only Next.js E2E test origins.

**Pre-production gate:** demonstrate anonymous read; review fetch gets application JSON 401 (not Gateway 302); review API with trusted user+valid token succeeds; all other ordinary APIs stay protected; nonce return works without putting the link token in IdP redirects, state or proxy logs; invalid nonce/cookie/CSRF/replay and revoked links fail closed. Update the original share-link spec §6.1/§15's anonymous-prefix checklist and attach actual sanitized Gateway configuration/trace **when integrating the company SSO**, not as an assertion in this docs-only PR.

## 5. Data model (MariaDB additive migration)

Use the **next available migration version**, not a hard-coded number without checking main. Extend Knowledge module domain/ports/application/MariaDB adapter; preserve repository import boundaries.

### `document_review_threads`

- id UUIDv7 PRIMARY KEY
- document_id UUID FK knowledge_documents, NOT NULL (scope is derived from document/source; do not duplicate workspace_id)
- created_revision_id UUID FK `knowledge_revisions(id)`, NOT NULL; the **sole** stored anchor revision identity (do not duplicate in anchor JSON)
- created_by UUID FK users, NOT NULL
- creation_idempotency_key VARCHAR(64) NOT NULL
- creation_request_hash CHAR(64) NOT NULL (SHA-256 of canonical validated creation payload, excluding raw share token)
- origin_share_link_id UUID FK document_share_links, NULL (audit provenance only; **not** the authorization or visibility boundary)
- anchor_json JSON NOT NULL, schemaVersion=1
- status ENUM('OPEN','RESOLVED') NOT NULL DEFAULT 'OPEN'
- visibility ENUM('VISIBLE','HIDDEN') NOT NULL DEFAULT 'VISIBLE'
- hidden_by UUID FK users NULL; hidden_at DATETIME(6) NULL; hidden_reason VARCHAR(200) NULL
- resolved_by UUID FK users NULL; resolved_at DATETIME(6) NULL
- created_at DATETIME(6) NOT NULL
- updated_at DATETIME(6) NOT NULL
- indexes (document_id, status, created_at), (created_by, created_at)
- UNIQUE(document_id, created_by, creation_idempotency_key) enforced by the database, not in-memory
- DB CHECK constraints for resolution consistency where supported

### `document_review_comments`

- id UUIDv7 PRIMARY KEY
- thread_id UUID FK `document_review_threads(id)` NOT NULL
- author_user_id UUID FK users NOT NULL
- body TEXT NOT NULL (application validates 1–3,000 chars)
- visibility ENUM('VISIBLE','HIDDEN') NOT NULL DEFAULT 'VISIBLE'
- hidden_by UUID FK users NULL; hidden_at DATETIME(6) NULL; hidden_reason VARCHAR(200) NULL
- created_at DATETIME(6) NOT NULL
- idempotency_key VARCHAR(64) NOT NULL; UNIQUE(thread_id, author_user_id, idempotency_key)
- request_hash CHAR(64) NOT NULL (SHA-256 of canonical validated reply payload)
- index (thread_id, created_at, id)

The initial message is the first `document_review_comments` row in the new thread, in the **same transaction**. **New thread creation needs its own idempotency key:** a uniqueness constraint on the first comment inside a newly generated thread ID does not prevent two duplicate threads. Same (document, creator, creation key) + identical canonical request returns the same thread and first comment after *fresh* link/identity authorization. Reusing a key with different payload returns 409 `IDEMPOTENCY_KEY_REUSED`. Replies use (thread, author, key) and compare payload hashes before returning a previous reply. DB uniqueness handles concurrent races; check-then-insert alone is insufficient. **Retry ordering:** always authenticate and revalidate the live link first; then check for an already-committed matching key and return its existing result if the canonical payload matches, even if a later Folder Sync advanced the current revision. For a genuinely new key, acquire the appropriate scope locks, require the selected revision to still be current, validate its anchor, and insert transactionally. If the unique index reports a concurrent winner, re-read and compare its payload after rechecking permission. Never return previous content through a revoked link. Keys must be validated, bounded and unpredictable (e.g. UUIDv4). Owner resolution creates an audit event with actor/time. No hard delete of review history in v1; this matches current document/link lifecycle conventions. **Owner hide/unhide** changes visibility with actor, time, reason and an audit event in one transaction. Hiding a whole thread hides all its comments from reviewers and frees visible-thread quota; hiding an individual **reply** exposes only a generic tombstone, not body or historical quote. **The first comment cannot be hidden independently:** the initial comment and its selected quote are the thread's context, so hiding the first comment must atomically hide the whole thread; otherwise the anchor/quote would leak the sensitive selection. Hidden content remains available only through an owner-only moderation projection and may remain in database/backups: this is **not secure erasure**, and confirmed secret disclosure still requires credential rotation and an incident response/deletion policy outside MVP. Owner moderation must remain possible for an archived document/source inside an ACTIVE PERSONAL Workspace (§12). Employee names are read from stored Hub users for display and never trusted from client payloads.

## 6. Anchoring and revisions

### 6.1 Anchor persisted at creation

Persist versioned anchor data:

~~~json
{
  "schemaVersion": 1,
  "blockPath": [4, 1],
  "blockKind": "paragraph",
  "startUtf16": 15,
  "endUtf16": 58,
  "exact": "the selected visible text",
  "prefix": "up to 64 visible characters immediately before",
  "suffix": "up to 64 visible characters immediately after"
}
~~~

The block path and text projection are **pure functions of persisted Markdown and a pinned Markdown AST/remark transform version**, independent of `MarkdownRenderer`, DOM shape, `links`, authorizations, syntax highlighting and network-resolved link targets. Owner `DocumentViewer` passes `links`, while anonymous `/s/:token` does not; their rendered wrappers can differ. Compute **the same canonical UTF-16 offsets from the AST** for both, and use the DOM selection only as an input that must map back to those canonical AST characters. If a block contains renderer-dependent wikilinks/relative document links or accessibility-only text such that a lossless selection-to-AST mapping cannot be guaranteed in both views, **disable new anchors in that block for MVP** rather than attach incorrectly. Start/end use UTF-16 offsets against the canonical AST text projection, not current DOM `textContent`. Add browser tests with and without `links`, with emoji/surrogate pairs, emphasis, inline code, and wikilinks, proving equal canonical anchors or explicit refusal. Inline formatting nodes are concatenated in reading order; normalize line endings/whitespace consistently, and document/test the exact canonicalizer. Cap the exact quote at 512 characters and the context at 64 characters each.

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

If Folder Sync or owner edit advances current_revision_id between selection and a **genuinely new** POST, reject creation with **409 STALE_DOCUMENT_REVISION** and return a refresh/reselect instruction. Do not try to guess or write against a stale source. Replying to an existing Open/Outdated thread can proceed after a newer revision as long as the link remains valid. Review comments must not modify Markdown, source snapshots, imports, document revisions, or the link index.

## 7. API boundaries (proposed)

Share tokens for comment APIs are in an HTTPS **JSON request body**, not new GET query parameters. Never construct absolute links from untrusted Host headers.

| Method | Path | Auth & behavior |
| --- | --- | --- |
| POST | /api/share-review/threads/query | Authenticated + valid token in JSON body. Returns bounded threads/comments for **one** document with safe current-revision anchor projections. |
| POST | /api/share-review/threads | Authenticated + valid token. Creates thread + first comment atomically; requires expectedRevisionId, selected anchor, body and **thread-creation idempotency key**. Safe retry returns the original thread only for identical payload. |
| POST | /api/share-review/threads/{threadId}/replies | Authenticated + valid token. Resolves thread-to-document and verifies token covers the *same* document; appends reply to Open thread with its own reply idempotency key (changed payload under same key: 409). |
| GET | /api/documents/{documentId}/review-threads | Authenticated document owner through normal Workspace authorization. May view history/anchor quote. |
| POST | /api/documents/{documentId}/review-threads/{threadId}/replies | Authenticated owner only. Append reply without needing a share link. |
| POST | /api/documents/{documentId}/review-threads/{threadId}/resolution | Authenticated owner only. status=OPEN or RESOLVED; no replies on resolved threads, even by owner, until reopened; idempotent updates and audit. |
| POST | /api/documents/{documentId}/review-threads/{threadId}/visibility | Authenticated owner only. Hide/unhide entire thread; audit and capacity accounting in one transaction. |
| POST | /api/documents/{documentId}/review-threads/{threadId}/comments/{commentId}/visibility | Authenticated owner only. Hide/unhide a reply, with audit; hiding the first comment atomically hides the whole thread to protect its anchor quote. Never expose hidden content in reviewer projections. |

The list endpoint is POST to avoid putting the bearer token in a URL; this is a deliberate read-via-POST exception. The public share page can remain a Server Component, with a small client-side review island loaded after authentication. No implicit call to Workspace APIs from anonymous /s/:token. The API Gateway must use §4.5's exact review route exception so the structured 401 contract is reachable.

Authentication status for review endpoints: 401 (not signed in), 404 uniform (invalid/inaccessible link/document/thread without revealing existence), 400 (invalid input/selection), 409 (stale revision, resolved thread reply, or changed payload under reused idempotency key), 429 (quota), 503 (trusted SSO integration unavailable), and 5xx generic for unexpected failures. Existing anonymous share-link route keeps uniform 404. Never return different error messages revealing why a token is invalid.

**Transaction and locking:** follow existing share revocation lock order to prevent a post-revocation write from committing: lock link row first for link-based mutations, then source, then shared Workspace lock and relevant thread, revalidating lifecycle/issuer access *after* locks. No Workspace owner membership is granted to reviewer. A revoke waits for in-flight comment mutation, or mutation sees revoked state and fails. Owner-only thread writes use Source → Workspace → Thread; do not invert these locks in any new path. Keep MariaDB READ COMMITTED semantics and integrate with the existing UnitOfWork pattern. Database-enforced idempotency protects **both** new-thread creation and replies (§5); retry-race recovery must recheck live link authorization before returning an existing result.

## 8. Implementation boundaries

- **Domain:** ReviewThread, ReviewComment, anchor validator/remapper and review authorization policy in Knowledge module.
- **Ports:** review-thread repository, comment repository, existing share-link and revision readers, audit writer.
- **Application:** distinct ReviewService use cases for token+caller and owner+caller. Do not overload the caller-less DocumentShareService.readShared with comment writes.
- **Infrastructure:** additive MariaDB migration and repository adapters, registered through UnitOfWork/composition.
- **Server:** focused review API handlers using trusted identity resolution, consistent HTTP errors, Origin/CSRF checks and no-store.
- **UI:** new client-only SharedReviewPanel adjacent to MarkdownRenderer; owner document review panel using shared thread components. Keep light/dark tokens and keyboard focus behavior from frontend-design-language.md.
- **Canonical docs:** change precisely the contracts enumerated in §12 (including Phase 3 §13, the old share-link non-goals, dialog text, Gateway checklist and invariant guard tests). These belong in the **future implementation PR** so this PR stays a single-document proposal.
- **Identity side effects:** reusing `establishTrustedCaller` will upsert/ensure each reviewer Hub user and their My Space, without sharing the owner's workspace (§4.4). This is a deliberate onboarding/deployment consideration.
- **CSRF scope:** add Origin/CSRF protection to the review API and login-start endpoint in this feature's implementation. Existing unrelated mutation APIs are **not implicitly protected**; a separate security-hardening task must audit and apply common safeguards there, rather than implying this spec retroactively fixes them.

No System or Module model, Team Workspace write access, external collaborative editor, Git source connection, notification bus, or publishing workflow is required.

## 9. Acceptance criteria and required tests

1. **Anonymous unchanged:** a valid /s/:token opens current Markdown without SSO, and anonymous attempts to query/create/reply to comments get no comment data and cannot write.
2. **SSO provenance and deferral:** injected trusted corporate-session claims and development-only identities can exercise commenting; submitted employee/user/author fields are ignored or rejected; missing/untrusted Company SSO cannot post (production fails closed). No deployed corporate login, callback or live SSO E2E is claimed; company sign-in is a later separate release gate (§4.4).
3. **One document scope:** a valid token for Document A cannot query, reply to, or change a thread on Document B, even with guessed UUIDs. A link provides no access to owner Workspace tree/search/history/MCP/other documents.
4. **Multi-link collaboration:** two different valid links to the same document show the same threads to authenticated users; revoking one removes its holders' review access but does not erase threads for the other link or owner.
5. **Owner controls:** only document owner can resolve/reopen and access the owner-only comments endpoint; owner can review after every link expires. Neither owner nor reviewer can reply to resolved threads until the owner reopens them.
6. **Sync-safe:** SOURCE_MANAGED Folder Sync changes source Markdown; comments remain in DB; no diff or import conflicts attributable to review data; unchanged quotes re-anchor and missing/ambiguous quotes become Outdated without mis-highlighting.
7. **Stale/idempotency safety:** superseded revision fails 409; same thread-creation key and payload retried after response loss creates exactly one **thread and first comment**; same reply key creates one reply. Different keys can create separate threads. Changed payload with same key fails 409, keys across users stay isolated, and revoked links cannot retrieve replayed data. Verify concurrent MariaDB races.
8. **History/privacy:** outdated reviewer payload never includes older exact quote/prefix/suffix or old Markdown, while owner retains enough provenance to triage.
9. **Security and moderation:** invalid/expired/revoked/archived links uniformly deny; review-specific CSRF/origin, no-store, token log redaction, per-user/visible quota limits and escaping are tested. Owner hides secret/spam comment or whole thread; reviewers see no hidden bodies/history, visible-thread capacity recovers, audit retains the actor. Emergency write-disable and soft-hide limits documented.
10. **UX/accessibility:** pointer and keyboard selection, focus/scroll between highlight and thread, reply/resolve/hide states, mobile drawer, and screen-reader announcement pass E2E. Same AST anchor projection for owner (`links`) and share page (no `links`), or the ambiguous selection is refused.
11. **CI:** unit tests (authorization/anchors), integration (MariaDB idempotency races/transactions/revocation/soft-hide and limits), E2E (anonymous → **test-session-authenticated** review → owner resolve → sync → outdated), typecheck, lint, build and existing regression gates pass **when implemented**. Real Gateway JSON-401/nonce/login E2E and corporate SSO remain a deferred deployment gate (§4.5).
12. **Gateway:** isolated Gateway fixture or contract tests demonstrate that XHR returns JSON 401 rather than an IdP HTML/302 and that the return nonce is single-use, cookie-bound and contains no share token in third-party URLs.
13. **Archive:** active/archived document, source and Workspace transitions follow the exact read/moderation rules in §12; restored documents retain safely hidden threads.

## 10. Implementation order after design approval

1. **writing-plans:** produce a task-by-task plan in docs/superpowers/plans, with migration rollback/roll-forward notes and file-level test steps.
2. **Backend foundation:** domain/ports, migration, repository tests, capability/identity/CSRF boundary against existing identity interfaces only; no corporate SSO login integration.
3. **Read and write API:** idempotency, link-revoke race, owner-only resolution/moderation endpoints, per-user/visible caps, Origin/CSRF and error mapping.
4. **Anchoring:** text-projection contract, selection validation, safe read-time remapping, stale handling.
5. **UX:** share reader sidebar and owner review/moderation panel, hide/tombstone states, E2E accessibility, gateway-response handling and test-identity flows. Company SSO and real Gateway integration remain deferred.
6. **Documentation & verification:** update §13's listed canonical invariants/tests in the implementation PR, run full gates, record real verification results in docs/superpowers/verification. Corporate rollout has a separate SSO/Gateway gate.

## 11. Open implementation details (not blockers for the product decision)

- **Deferred company task, not an MVP design blocker:** supply the company-approved SSO sign-in initiation/return handling through the existing trusted session seam **and configure/verify §4.5's Gateway route exceptions and nonce flow**. The contract is designed here, not implemented here. Until wired, production review UI must explain that commenting sign-in is unavailable, not offer a broken link or test-account fallback.
- Pin the exact AST-visible-text canonicalization and block identity implementation with round-trip tests before accepting real anchors.
- Choose an existing distributed/shared rate limiter or a MariaDB rate-limit ledger consistent with internal deployment needs.
- Confirm layout placement and responsive styling through screenshots after the implementation branch exists.

## 12. Archive behavior and review-data lifecycle

| State | Link-based reviewer | PERSONAL Workspace owner |
| --- | --- | --- |
| Document, Source and Workspace all ACTIVE | Read current document; authenticated review read/new thread/reply on OPEN visible threads | Full review read/reply, resolution and moderation |
| Document ARCHIVED, Workspace ACTIVE | Share link invalid; no review access | Archive-aware **owner-only moderation/read projection** may view/hide sensitive history; no new thread, ordinary reply or resolve until restored |
| Source ARCHIVED, Workspace ACTIVE | Share link invalid; no review access | Same archive-aware owner-only moderation/read, no conversational writes |
| Workspace ARCHIVED | Share link invalid; no review access | No review data access or writes through this feature; restore Workspace using existing governance before review |
| Restore to ACTIVE | New, currently valid links may regain scoped review access under ordinary validity rules | Thread/visibility/resolution history preserved, hidden content remains hidden |

Document and Source archive/restore never hard-delete review records; the owner-only archived moderation route must check derived PERSONAL ownership rather than allow general historical document access. The original share-link validity predicate is unchanged. Because review data is retained (including bodies in backups), **Hide is redaction of user-facing projections, not physical secret erasure**. Credential rotation, security reporting and eventual legal retention/deletion policy are separate operational needs. If abuse reaches storage limits, the owner can hide malicious threads (releasing *visible* capacity); per-user limits and an emergency write switch bound the ongoing risk.

## 13. Canonical contracts, code guards and rollout checklist

**Not changed in this docs-only PR; required in the future implementation PR:** 

1. `CLAUDE.md`: replace the phrase that one share token allows exactly one caller-less read and "never any write" with **two narrowly disjoint grants**: anonymous read via `/s/:token`, and authenticated token+trusted caller *review-record-only* access via exact review APIs. Document content/revisions, search, Workspace membership and MCP remain denied.
2. `docs/superpowers/specs/2026-09-23-document-share-link-design.md`: amend §2 "Editing or comments through the link" and "API/MCP token reads" non-goals; §3.1 token-accepted-by table; §3.2 canonical wording; §4 and §10.2 Share dialog copy; §6.1 sole caller-less **document-content** read and Gateway routing; §6.2 non-expansion; §9.4 routes; §13 acceptance tests; §15 documentation and rollout checklist. Link still does not permit Markdown edit, and comment access still requires identity. Keep implementation history clear rather than rewriting its earlier shipped behavior as though it already included reviews.
3. `docs/superpowers/specs/2026-09-14-phase-3-identity-workspace-governance-design.md` §13: update the explicit "read-only bearer grant" exception, while preserving that a link is not a Document ACL or Workspace membership.
4. `tests/unit/share-link-single-exception.test.ts`: keep the invariant that **only `DocumentShareService.readShared` can return document revision content with no caller**; expand the guard to allow the exact authenticated review service + review routes to accept a token and persist review metadata *only*. Add static and behavioral negative checks that review routes cannot read previous revisions, document trees or other content via tokens; do not simply remove the old guard.
5. `README.md` / `README.zh-TW.md` and in-app Help guide: update sharing/SSO/comment copy when shipped; add canonical spec/plan/verification index entries. Update `frontend-design-language.md` only if new visual tokens are required.

**Company rollout checklist, deferred until the internal gateway/SSO integration exists:**

- [ ] Gateway route policy specifically allows anonymous GET `/s/*`, static assets, unauthenticated forwarding of only `/api/share-review/*` to app-enforced identity; if enabled, POST `/auth/review/start`. Protect `/auth/review/continue` and all regular APIs. No broad `/api/*` bypass.
- [ ] Unauthenticated fetch to review API demonstrably returns application JSON `401 AUTH_REQUIRED` (not auto-followed IdP HTML), and misconfiguration fails safely.
- [ ] Same-origin nonce/cookie continuation tested across the actual SSO Gateway; no document token in external IdP URL, state, referrer, access log or analytics. TTL, nonce replay, cookie binding and redirect allowlist verified.
- [ ] Origin/CSRF, SameSite cookies, HTTPS, no-store, token masking, Gateway rate limits and identity-provider failure behavior verified.
- [ ] With production trusted identity, two colleagues on different valid links see the same discussion; no login or an invalid link never exposes discussion; corporate offboarding/revocation disables access.
- [ ] Emergency review-write disable, owner hide/unhide, storage quotas and moderation audits exercised; archive/restore semantics verified.
- [ ] Actual sanitized Gateway config, privacy review, corporate sign-in evidence and test results recorded in `docs/superpowers/verification/` before enabling review in production.

**Recommendation:** approve this document-scoped, SSO-gated, link-based inline review design; next produce the writing-plans checklist. Implement System and Module ownership only after this personal-share review loop is validated.

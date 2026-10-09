# Shared Personal Document Inline Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (\`- [ ]\`) syntax for tracking.

**Goal:** A My Space owner shares one current Markdown document; authenticated valid-link holders review selected passages in a shared discussion, while the owner can reply, resolve and safely hide comments without changing Markdown or breaking Folder Sync.

**Architecture:** Add document-scoped review records, audit events and a storage-backed write ledger to MariaDB, with small Knowledge module ports/services using the existing \`KnowledgeUnitOfWork\`. A pinned Markdown AST text projection validates reviewer selections and safely reanchors on the current revision; narrow token+trusted-caller routes and an isolated review UI consume that projection. Keep anonymous \`DocumentShareService.readShared\` intact. **Corporate SSO Gateway/passive-auth, login nonce/continuation and real IdP are explicitly deferred** to a separate deployment gate.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, MariaDB 10.11, \`mdast-util-from-markdown\`/\`remark-gfm\` + existing Markdown utilities, Vitest, Playwright, Tailwind/Base UI.

**Spec:** \`docs/superpowers/specs/2026-10-09-shared-personal-document-inline-review-design.md\` (PR #154, approved to plan; do not treat it as already implemented).

## Global Constraints

- My Space PERSONAL documents only; SOURCE_MANAGED files remain read-only from Hub review. Do not add System/Module/Team review, document ACLs, or edit Markdown.
- Reviewer comment access = valid **live** share token **AND** verified \`CallerContext\`; owner access = derived PERSONAL Workspace ownership. Never infer membership or trust browser identity fields. Anonymous link readers receive no comment bodies, names, counts or old quotes.
- Review rows store \`document_id\`, **not** \`source_id\` or \`workspace_id\`; derive Document → Source → Workspace. UUIDv7 for new entities, UUIDv4 unpredictable idempotency keys. Share token remains UUIDv4.
- Next available additive migration at execution time: baseline \`main\` inspected 2026-10-09 contains \`016-reading-activity\`; **reserve 017 only if still free**, otherwise rebase plan/number before coding. Use \`knowledge_revisions(id)\` as the revision FK.
- DB uniqueness: \`(document_id, created_by, creation_idempotency_key)\` for thread create and \`(thread_id, author_user_id, idempotency_key)\` for comments; canonical SHA-256 request hashes omit share token. Authenticate/revalidate before idempotent replay. Same key+different payload → 409; concurrent exact duplicates → one write.
- Lock order: link-based mutation \`Link FOR UPDATE → Source FOR UPDATE → Workspace shared lock → Thread\`; owner-only \`Source → Workspace shared → Thread\`. Source lock also serializes visible/creator quota count+write under READ COMMITTED; recheck scope/lifecycle under locks.
- Limits: comment body 1–3,000 Unicode characters; selected exact ≤512 characters; prefix/suffix ≤64 each; 200 **VISIBLE** threads/document; 20 **VISIBLE OPEN** threads/creator/document; 100 replies/thread; 30 write events/user/document/rolling hour. Quota checks apply to **unhide** and retries do not charge a new write; count hidden replies toward lifetime reply limit.
- First comment's visibility stays VISIBLE; hide on that comment hides the thread. Hidden thread suppresses all replies/quotes in reviewer projection; individually hidden later replies stay hidden after unhide. Owner-only archive-aware moderation is available for archived document/source in ACTIVE PERSONAL Workspace; archived Workspace itself blocks review.
- No old Markdown or outdated exact/prefix/suffix to reviewer; no body/quote/secret reason/token in \`workspace_audit_events\`, proxy logs, error telemetry or metadata. Hide is projection-level, **not physical erasure**.
- Every review API request/response uses \`private, no-store\`. POST mutations require same-origin/CSRF validation. No broad auth/Origin rewrite of unrelated APIs in this feature.
- \`/s/:token\` remains anonymous even when Company SSO is unconfigured; production comment APIs fail closed rather than falling back to local test identity. Production write enablement must be a separately gated configuration.
- Test loop: \`npm run test:unit -- <test-file>\` targets a unit file; \`npm run test:integration\` runs the **whole** MariaDB integration suite (its wrapper does not forward filters); \`npm run test:e2e -- <test-file>\` targets an E2E file. \`make verify\` = unit + typecheck + lint + build. Before marking tasks done, record *actual* command results.

## Review Focus

1. **Spoofed employee headers / missing Gateway session (Task 8):** no forged \`CallerContext\` or account provisioning; without Company SSO review endpoints fail closed and anonymous document reading remains available. Real optional-auth Gateway trace is a separate production gate.
2. **Double-click or lost response during Folder Sync (Tasks 4, 6):** same creation/reply key writes once and returns existing result even after revision advancement; a genuinely new stale key returns 409.
3. **Duplicated quote, wikilink, emoji and layout mismatch (Task 3):** server and both document readers agree on AST UTF-16 offsets, or selection is rejected/marked OUTDATED; never attach to a different occurrence.
4. **Owner hides a leaked secret (Tasks 5, 7):** no sensitive body, opener quote, historical context or hidden reason in reviewer JSON *or audit payload*, including after unhide/rearchive behavior.
5. **Token expires or is revoked mid-request (Tasks 5, 6, 8):** link-lock revalidation yields non-enumerating 404 with zero new writes, even on idempotent retries.

---

## File Structure (paths and ownership)

| Task | Create | Modify / integration points |
| --- | --- | --- |
| 1 | \`src/infrastructure/database/mariadb/migrations/017-document-review.ts\`; \`tests/integration/document-review-schema.test.ts\` | \`src/infrastructure/database/mariadb/migrations/index.ts\` |
| 2 | \`src/modules/knowledge/domain/document-review.ts\`; \`tests/unit/document-review-domain.test.ts\` | None |
| 3 | \`src/modules/knowledge/domain/review-anchor.ts\`; \`tests/unit/review-anchor.test.ts\` | \`src/components/knowledge/markdown-base.tsx\` (only if needed for stable block metadata); \`tests/e2e/document-review-anchors.spec.ts\` |
| 4 | \`src/modules/knowledge/ports/document-review-thread-repository.ts\`; \`document-review-comment-repository.ts\`; \`document-review-write-ledger.ts\` (same ports folder); \`src/infrastructure/database/mariadb/repositories/document-review-threads.ts\`; \`document-review-comments.ts\`; \`document-review-write-ledger.ts\`; \`tests/integration/document-review-repositories.test.ts\` | \`src/modules/knowledge/ports/unit-of-work.ts\`; \`src/infrastructure/database/mariadb/repositories/index.ts\` |
| 5 | \`src/modules/knowledge/application/document-review-service.ts\`; \`tests/integration/document-review-access.test.ts\` | Existing \`src/modules/knowledge/domain/document-share-link.ts\` validity rules **reuse, do not weaken** |
| 6 | \`tests/integration/document-review-writes.test.ts\` | \`document-review-service.ts\`; repository adapters from Task 4 |
| 7 | \`tests/integration/document-review-owner.test.ts\` | \`document-review-service.ts\`; review repositories/audit events |
| 8 | \`src/server/review-http.ts\`; \`src/server/review-config.ts\`; \`src/server/review-origin.ts\`; \`src/app/api/share-review/threads/query/route.ts\`; \`src/app/api/share-review/threads/route.ts\`; \`src/app/api/share-review/threads/[threadId]/replies/route.ts\`; \`src/app/api/documents/[documentId]/review-threads/**/route.ts\`; \`tests/unit/review-http.test.ts\` | \`src/server/composition.ts\`; \`src/server/http-error-response.ts\`; review endpoint tests |
| 9 | \`src/components/knowledge/shared-review-panel.tsx\`; \`review-thread-list.tsx\`; \`review-selection.ts\`; \`tests/e2e/shared-review.spec.ts\` | \`src/app/s/[token]/page.tsx\`; \`src/modules/knowledge/application/document-share-service.ts\` (add current revision ID); \`src/components/knowledge/share-link-dialog.tsx\` |
| 10 | \`src/components/knowledge/owner-review-panel.tsx\`; \`tests/e2e/owner-review.spec.ts\` | \`src/components/knowledge/document-pane.tsx\` / \`document-viewer.tsx\` (inspect final owner mounting point) |
| 11 | \`docs/superpowers/verification/2026-10-09-shared-personal-document-inline-review.md\` | \`CLAUDE.md\`; share-link spec §2/§3/§4/§6/§9/§10/§13/§15; Phase 3 spec §13; \`tests/unit/share-link-single-exception.test.ts\`; \`README.md\`; \`README.zh-TW.md\` |
| Deferred corporate integration | **No corporate SSO/Gateway implementation in this plan** | A separately approved plan/config: Gateway passive auth; strip spoofed headers; trusted upstream; same-origin nonce form POST/continuation; corporate E2E and rollout evidence |

Names/signatures below are **proposed implementation contracts**; keep them stable across tasks. The existing \`src/modules/sources/ports/unit-of-work.ts\` extends \`KnowledgeRepositories\`, so Task 4 must update \`createRepositories\` consistently.

### Task 1: Additive MariaDB schema and reversible rollout procedure

**Files:** Create \`017-document-review.ts\`, \`tests/integration/document-review-schema.test.ts\`; modify \`migrations/index.ts\`.

**Interfaces:** Export \`documentReviewMigration: Migration\` (\`version: 17\` only after confirming unused); tables \`document_review_threads\`, \`document_review_comments\` and \`document_review_write_events\` (storage-backed sliding-hour ledger: \`id,user_id,document_id,created_at\`, index \`(user_id,document_id,created_at)\`). Review tables use the fields, UNIQUE keys, constraints and FKs in spec §5; no Source/Workspace FK duplicated.

- [ ] **Step 1: Write failing schema integration tests.** \`review schema has unique creation and reply keys\` queries \`information_schema.STATISTICS\` and verifies separate unique indexes; \`review records store no scope duplicates\` asserts neither review table has \`workspace_id\`/\`source_id\`; \`opener visibility is constrained\` checks flags/metadata, and \`ledger supports hourly-user-document window\` validates index.
- [ ] **Step 2: Run red.** \`npm run test:integration\`; expected test failure until migration is registered and applied to the test DB.
- [ ] **Step 3: Implement additive migration.** Use MariaDB native UUID, InnoDB, explicit FK RESTRICT and index/check conventions from migration 011. Store creation/reply SHA-256 hashes, status/visibility columns, \`created_revision_id\` referencing \`knowledge_revisions(id)\`; one initial comment per new thread transaction. Add migration registration *after* current last version.
- [ ] **Step 4: Run green.** \`npm run test:integration && npm run typecheck\`; expected zero failed tests. Record migration **forward-only production rollout**: backup → apply migration → deploy code; rollback app does **not** drop persisted review data; schema rollback requires explicit maintenance/backup (not an automatic destructive down).
- [ ] **Step 5: Commit.** \`git add src/infrastructure/database/mariadb/migrations tests/integration/document-review-schema.test.ts && git commit -m "feat(review): add review schema and write ledger"\`.

### Task 2: Review types, quotas, validation and safe projection policy

**Files:** Create \`src/modules/knowledge/domain/document-review.ts\`, \`tests/unit/document-review-domain.test.ts\`.

**Interfaces:** Define/export \`ReviewThread\`, \`ReviewComment\`, \`ReviewStatus = "OPEN" | "RESOLVED"\`, \`ReviewVisibility = "VISIBLE" | "HIDDEN"\`, \`ReviewThreadView\`, \`ReviewCommentView\`, \`CreateReviewThreadInput\`, \`ReplyReviewInput\`; \`validateReviewBody(body: unknown): string\`; \`validateReviewIdempotencyKey(key: unknown): string\`; \`projectReviewerThread(thread, comments, currentAnchor): ReviewThreadView | null\`; immutable constants \`REVIEW_LIMITS = { body:3000, quote:512, context:64, visibleThreads:200, visibleOpenPerCreator:20, replies:100, hourlyWrites:30 }\`.

- [ ] **Step 1: Tests.** \`validateReviewBody\` rejects empty and >3,000 Unicode code points and raw HTML is never rendered as HTML; key rejects non-UUIDv4/oversized keys; hidden thread projects to \`null\`; hidden reply is only \`"Comment hidden by document owner"\` with no body; OUTDATED strips \`exact/prefix/suffix\`; first comment cannot be independently HIDDEN.
- [ ] **Step 2: Run red.** \`npm run test:unit -- tests/unit/document-review-domain.test.ts\`; expect missing exports/tests to fail.
- [ ] **Step 3: Implement pure validations and projections.** Model the first reply as opener but never expose hidden original text; keep owner-only projection a distinct function/type so the reviewer DTO cannot accidentally serialize persisted JSON.
- [ ] **Step 4: Run green.** Same unit command plus \`npm run typecheck && npm run lint\`.
- [ ] **Step 5: Commit.** \`git add src/modules/knowledge/domain/document-review.ts tests/unit/document-review-domain.test.ts && git commit -m "feat(review): define validation and safe projections"\`.

### Task 3: Canonical AST anchors, safe relocation and selectable-block contract

**Files:** Create \`src/modules/knowledge/domain/review-anchor.ts\`, \`tests/unit/review-anchor.test.ts\`, \`tests/e2e/document-review-anchors.spec.ts\`; modify \`markdown-base.tsx\` only if client block markers are required.

**Interfaces:** \`ReviewAnchor = { schemaVersion:1; blockPath:number[]; blockKind:"heading"|"paragraph"|"listItem"|"blockquote"; startUtf16:number; endUtf16:number; exact:string; prefix:string; suffix:string }\`; export \`projectReviewBlocks(markdown:string): CanonicalReviewBlock[]\` (path, kind, UTF-16 text, selectable Boolean); \`validateReviewAnchor(markdown:string, anchor:ReviewAnchor):ReviewAnchor\` (throws for mismatch); \`relocateReviewAnchor(currentMarkdown:string, original:ReviewAnchor, sameRevision:boolean): {match:"MATCHED"|"MOVED"|"OUTDATED"; anchor?:ReviewAnchor}\`. The enclosing service, not client, supplies \`sameRevision\` from trusted revision IDs.

- [ ] **Step 1: Tests.** One paragraph with emoji/surrogate pair, bold, inline code, line endings and whitespace yields deterministic UTF-16 offsets; owner \`links\` vs shared reader without \`links\` produces equal safe anchors or blocks selection; \`[[Wiki]]\`/relative links and unrendered/complex blocks reject ambiguous selection; duplicate quote returns OUTDATED; context-unique moved quote returns MOVED; cap exact 512/prefix/suffix 64 and bound remap scan.
- [ ] **Step 2: Run red.** \`npm run test:unit -- tests/unit/review-anchor.test.ts\`; expect missing functions to fail.
- [ ] **Step 3: Implement canonicalizer.** Use installed Markdown AST parsing utilities, pinned transforms, never DOM \`textContent\` as truth. Define the exact block-path and newline normalization in comments. Ensure a browser selection maps back to the same canonical offsets; when mapping cannot be proved, disable Comment for that block, never guess.
- [ ] **Step 4: Run green.** Unit command plus \`npm run typecheck && npm run lint\`; later Task 9 runs browser anchor E2E against the actual rendered views.
- [ ] **Step 5: Commit.** \`git add src/modules/knowledge/domain/review-anchor.ts src/components/knowledge/markdown-base.tsx tests/unit/review-anchor.test.ts tests/e2e/document-review-anchors.spec.ts && git commit -m "feat(review): validate and relocate AST anchors"\` (stage only files actually modified).

### Task 4: Review repository ports, MariaDB adapters, counts and idempotency storage

**Files:** Create \`document-review-thread-repository.ts\`, \`document-review-comment-repository.ts\`, \`document-review-write-ledger.ts\` in Knowledge ports; corresponding MariaDB repository files; \`tests/integration/document-review-repositories.test.ts\`. Modify \`unit-of-work.ts\` and MariaDB \`repositories/index.ts\`.

**Interfaces:**
- \`DocumentReviewThreadRepository\`: \`insert(thread):Promise<void>\`, \`findById(id):Promise<ReviewThread|null>\`, \`lockById(id):Promise<ReviewThread|null>\`, \`findByCreationKey(documentId,authorId,key):Promise<ReviewThread|null>\`, \`listByDocument(documentId):Promise<ReviewThread[]>\`, \`countVisibleByDocument(documentId):Promise<number>\`, \`countVisibleOpenByCreator(documentId,creatorId):Promise<number>\`, \`setVisibility(...):Promise<void>\`, \`setResolution(...):Promise<void>\`.
- \`DocumentReviewCommentRepository\`: \`insert(comment):Promise<void>\`, \`findByReplyKey(threadId,authorId,key):Promise<ReviewComment|null>\`, \`listByThread(threadId):Promise<ReviewComment[]>\`, \`countReplies(threadId):Promise<number>\`, \`setVisibility(...):Promise<void>\`.
- \`DocumentReviewWriteLedger\`: \`countSince(userId,documentId,since:Date):Promise<number>\`, \`record(userId,documentId,at:Date):Promise<void>\`. Ledger writes occur only for **new** successful creates/replies; periodic deletion of >retention window is a maintenance task, not a review API side effect.

- [ ] **Step 1: Write integration tests.** FK target \`knowledge_revisions\`; unique constraint rejects duplicate thread creation key and duplicate reply key; separate users/keys coexist; \`countVisibleOpenByCreator\` ignores resolved/hidden; \`countReplies\` excludes opener but includes hidden replies; all tests run against real MariaDB.
- [ ] **Step 2: Run red.** \`npm run test:integration\`; expect the new repository tests to fail until adapters and wiring exist.
- [ ] **Step 3: Implement small adapters and UoW wiring.** Use parameterized SQL, existing \`DbRow\`/mapping helpers. No new ORM and no direct DB calls from \`src/server\`. Update \`createRepositories\` and \`KnowledgeRepositories\` together.
- [ ] **Step 4: Run green.** \`npm run test:integration && npm run typecheck && npm run lint\`.
- [ ] **Step 5: Commit.** \`git add src/modules/knowledge/ports src/infrastructure/database/mariadb/repositories tests/integration/document-review-repositories.test.ts && git commit -m "feat(review): persist review threads, replies and quotas"\`.

### Task 5: Scoped read service and current-revision-only reviewer projection

**Files:** Create \`src/modules/knowledge/application/document-review-service.ts\`, \`tests/integration/document-review-access.test.ts\`.

**Interfaces:** \`new DocumentReviewService(unitOfWork:KnowledgeUnitOfWork, clock?:()=>Date)\`; \`listForLink(caller:CallerContext, token:string):Promise<ReviewThreadView[]>\`; \`listForOwner(caller:CallerContext, documentId:string):Promise<OwnerReviewThreadView[]>\` (owner DTO includes hidden audit context and may inspect original quote).

- [ ] **Step 1: Tests.** Different valid links A/B to same document return shared threads to authenticated users; anonymous has no \`CallerContext\` route and obtains no review data; token for other document yields indistinguishable 404; expired/revoked/archived link returns same hidden-not-found; owner sees threads after link expiry; reviewer receives only matched/current visible quote, OUTDATED never includes old exact/prefix/suffix, hidden thread omitted; archived document/source owner can read for moderation while archived Workspace blocks.
- [ ] **Step 2: Run red.** \`npm run test:integration\`; expected missing service/failing assertions.
- [ ] **Step 3: Implement per-request authorization.** Reuse \`evaluateShareLinkValidity\`/current membership lookup from \`DocumentShareService.readShared\`; owner check via derived PERSONAL Workspace. Return *bounded* current-revision DTO, use \`relocateReviewAnchor\`, never return unbounded current Markdown or previous revision content through review API.
- [ ] **Step 4: Run green.** \`npm run test:integration && npm run typecheck && npm run lint\`.
- [ ] **Step 5: Commit.** \`git add src/modules/knowledge/application/document-review-service.ts tests/integration/document-review-access.test.ts && git commit -m "feat(review): enforce link-scoped review reads"\`.

### Task 6: New thread/reply mutations with locking, unique-key retries and quota ledger

**Files:** Modify \`document-review-service.ts\`; create \`tests/integration/document-review-writes.test.ts\`.

**Interfaces:** \`createForLink(caller:CallerContext, input:{token:string;expectedRevisionId:string;anchor:ReviewAnchor;body:string;idempotencyKey:string}):Promise<ReviewThreadView>\`; \`replyForLink(caller:CallerContext,input:{token:string;threadId:string;body:string;idempotencyKey:string}):Promise<ReviewCommentView>\`. Internal \`withLockedLinkDocument(token,callback)\` locks Link→Source→Workspace and revalidates issuer/lifecycle; never exposes other documents.

- [ ] **Step 1: Tests.** Same create key and payload in simultaneous requests → one thread+opener; same reply key → one comment; differing payload under same key 409; same successful key replay after Folder Sync still returns original result if link valid; *new* key after revision advance → 409 STALE_DOCUMENT_REVISION; revoked token on retry → 404/no body; wrong document token cannot reply to another document's thread; resolved/hidden threads reject reviewer reply.
- [ ] **Step 2: Run red.** \`npm run test:integration\`; expected failing mutation tests.
- [ ] **Step 3: Implement in transaction.** Validate link and trusted caller **before** key replay; for genuinely new writes lock Link→Source→Workspace→Thread, revalidate again, verify current revision/AST anchor, enforce per-document/per-creator/reply and rolling-hour counts, insert records+write ledger atomically. On duplicate unique constraint re-read canonical hash and recheck authorization; no in-memory-only rate limit. Use 409 for capacity conflict and 429 for hourly write exhaustion.
- [ ] **Step 4: Run green.** \`npm run test:integration && npm run typecheck && npm run lint\`; repeat concurrency test enough to expose lost-update/idempotency races, never assume \`check-then-insert\` is safe.
- [ ] **Step 5: Commit.** \`git add src/modules/knowledge/application/document-review-service.ts tests/integration/document-review-writes.test.ts && git commit -m "feat(review): add safe thread creation and replies"\`.

### Task 7: Owner-only replies, resolve/reopen and audited hide/unhide

**Files:** Modify \`document-review-service.ts\`; create \`tests/integration/document-review-owner.test.ts\`.

**Interfaces:** \`replyForOwner(caller:CallerContext,input:{documentId:string;threadId:string;body:string;idempotencyKey:string}):Promise<ReviewCommentView>\`; \`setResolution(caller:CallerContext,input:{documentId:string;threadId:string;status:ReviewStatus}):Promise<void>\`; \`setVisibility(caller:CallerContext,input:{documentId:string;threadId:string;commentId?:string;visibility:ReviewVisibility;reason?:string}):Promise<void>\`.

- [ ] **Step 1: Tests.** Only PERSONAL owner can resolve/reopen/hide/unhide; neither owner nor reviewer replies to RESOLVED thread before owner reopens; hide opener hides thread but opener row remains VISIBLE; hidden later reply stays hidden after thread unhide; unhide at 200 visible threads or at 20 visible/open per creator → 409 and no state change; archive document/source allows owner read/hide but not reply/resolve; archive Workspace disallows; each state change yields one \`workspace_audit_events\` row **with IDs/action only**.
- [ ] **Step 2: Run red.** \`npm run test:integration\`; expected failure.
- [ ] **Step 3: Implement owner mutations with Source lock.** Owner-only Source→Workspace shared→Thread; count visible caps under Source lock on unhide; idempotent state transitions; initial-comment visibility remains VISIBLE; emit append-only audit event within transaction. Never copy secret body/exact/prefix/suffix/\`hidden_reason\` into audit payload.
- [ ] **Step 4: Run green.** \`npm run test:integration && npm run typecheck && npm run lint\`; explicitly inspect a secret-bearing audit fixture with no leaked content.
- [ ] **Step 5: Commit.** \`git add src/modules/knowledge/application/document-review-service.ts tests/integration/document-review-owner.test.ts && git commit -m "feat(review): implement owner moderation and audit"\`.

### Task 8: Secure review HTTP routes, readiness/capability seam and failure mapping

**Files:** Create \`src/server/review-http.ts\`, \`src/server/review-origin.ts\`, \`src/server/review-config.ts\`, reviewer routes under \`src/app/api/share-review/threads/\`, owner routes under \`src/app/api/documents/[documentId]/review-threads/\`, \`tests/unit/review-http.test.ts\`; modify \`src/server/composition.ts\`, \`src/server/http-error-response.ts\`.

**Interfaces:** \`reviewHttp(request:Request, operation:(service:DocumentReviewService,caller:CallerContext)=>Promise<unknown>, status?:number):Promise<Response>\`; \`assertReviewOrigin(request:Request):void\`; \`reviewLoginAvailable():boolean\` reads **trusted server configuration**, never browser flag; \`reviewWritesEnabled():boolean\` reads \`KM_REVIEW_WRITES_ENABLED === "true"\` (default false; only trusted deployer enables writes). Reads may remain enabled with unavailable sign-in, but require trusted identity. Existing \`applicationServices().establishTrustedCaller()\` supplies actual \`CallerContext\` when configured, and review server must map missing provider/readiness explicitly to 503 (no local production fallback).

- [ ] **Step 1: Tests.** No authenticated session → structured JSON \`401 AUTH_REQUIRED\` (with stubbed trusted identity reader); unconfigured company reader → \`503 AUTH_UNAVAILABLE\` and no DB/identity write; wrong Origin or missing relevant CSRF protection → 403/400; invalid token or thread → non-enumerating 404; no-store for 200 and errors; body token only (never URL); two valid callers may query; \`reviewWritesEnabled() === false\` rejects reviewer writes but permits owner **hide**/read; trusted test caller exercises route, spoofed browser \`emp_id\` is ignored.
- [ ] **Step 2: Run red.** \`npm run test:unit -- tests/unit/review-http.test.ts\`; expect missing HTTP helpers/routes to fail.
- [ ] **Step 3: Implement specific routes/JSON mapping.** POST \`/api/share-review/threads/query\`, POST \`/api/share-review/threads\`, POST \`/api/share-review/threads/[threadId]/replies\`; GET owner thread list, POST owner reply/resolution/thread visibility/comment visibility. Apply JSON schema/body caps, same-origin/CSRF on cookie-authenticated mutations, and no-store on all paths. Do **not** put company login/nonce/Gateway code or fake auth in this implementation.
- [ ] **Step 4: Run green.** \`npm run test:unit -- tests/unit/review-http.test.ts && npm run typecheck && npm run lint\`; add route-level test verifying only safe current revision fragments may be serialized.
- [ ] **Step 5: Commit.** \`git add src/server src/app/api/share-review src/app/api/documents tests/unit/review-http.test.ts && git commit -m "feat(review): expose guarded review APIs"\` (stage only relevant changed files).

### Task 9: Anonymous share page with authenticated inline review island

**Files:** Create \`shared-review-panel.tsx\`, \`review-thread-list.tsx\`, \`review-selection.ts\` under Knowledge components; \`tests/e2e/shared-review.spec.ts\`; modify \`src/app/s/[token]/page.tsx\`, \`document-share-service.ts\`, \`share-link-dialog.tsx\`. Execute Task 3 browser anchor tests.

**Interfaces:** \`<SharedReviewPanel token={token} revisionId={revisionId} markdown={markdown} reviewLoginAvailable={boolean} />\`. Add \`revisionId:string\` to \`SharedDocumentView\` from **current revision only**; never expose history. Reuse Task 2 review DTOs, Task 3 AST selection and Task 8 API routes.

- [ ] **Step 1: E2E tests.** Anonymous share still displays Markdown and no comment names/counts; when \`reviewLoginAvailable=false\`, the UI says sign-in is unavailable and never constructs an IdP URL; test session reads two users' shared thread, selects a paragraph, creates a thread and replies; scrolling/highlighting matches AST; keyboard access and mobile drawer; 401 prompts sign-in only when server capability says available; HTML/redirect response triggers neutral misconfiguration error.
- [ ] **Step 2: Run red.** \`npm run test:e2e -- tests/e2e/shared-review.spec.ts\`; expected failure before UI exists.
- [ ] **Step 3: Implement small client island.** Comments remain separate from \`MarkdownRenderer\`/Markdown; use existing Tailwind design tokens, Base UI focus, accessible selection affordance, right rail/mobile drawer, Refresh discussions (no realtime polling needed). Explicitly refuse selection that cannot map to AST; never use browser-supplied exact/offset as server truth. In company mode without login infrastructure keep anonymous reading working and review unavailable.
- [ ] **Step 4: Run green.** \`npm run test:e2e -- tests/e2e/shared-review.spec.ts && npm run test:e2e -- tests/e2e/document-review-anchors.spec.ts && npm run typecheck && npm run lint\`; verify existing \`tests/e2e/share-link.spec.ts\` still succeeds.
- [ ] **Step 5: Commit.** \`git add src/components/knowledge src/app/s tests/e2e/shared-review.spec.ts tests/e2e/document-review-anchors.spec.ts src/modules/knowledge/application/document-share-service.ts && git commit -m "feat(review): show inline review on shared documents"\`.

### Task 10: Owner review panel and moderation UX

**Files:** Create \`src/components/knowledge/owner-review-panel.tsx\`, \`tests/e2e/owner-review.spec.ts\`; mount in existing owner viewer/pane after inspecting current code (\`src/components/knowledge/document-pane.tsx\` and \`document-viewer.tsx\`). Reuse \`review-thread-list.tsx\`.

**Interfaces:** \`<OwnerReviewPanel documentId={documentId} revisionId={revisionId} markdown={markdown} />\`. Owner list reads only the owner endpoint; no share token needed. Buttons: Reply, Resolve, Reopen, Hide thread, Hide reply, Unhide; first-message hide routes through thread visibility.

- [ ] **Step 1: E2E tests.** Owner opens My Space and sees colleagues' review after links expire; resolve disables all replies until reopen; hidden thread/comment body is visible only in owner moderation state and removed from reviewer response; "Hide first comment" hides whole thread; archive document/source retains owner moderation; owner actions do not mutate imported Markdown or folder sync state.
- [ ] **Step 2: Run red.** \`npm run test:e2e -- tests/e2e/owner-review.spec.ts\`.
- [ ] **Step 3: Implement owner panel.** Keep the existing document viewer/edit behavior, place review as an optional panel, use the shared thread widgets and existing dialog/toast/focus patterns. No full-width redesign or System/Module navigation change.
- [ ] **Step 4: Run green.** \`npm run test:e2e -- tests/e2e/owner-review.spec.ts && npm run typecheck && npm run lint\`.
- [ ] **Step 5: Commit.** \`git add src/components/knowledge tests/e2e/owner-review.spec.ts && git commit -m "feat(review): add owner review moderation"\`.

### Task 11: Non-expansion guards, canonical docs and full regression evidence

**Files:** Modify \`tests/unit/share-link-single-exception.test.ts\`, \`CLAUDE.md\`, \`docs/superpowers/specs/2026-09-23-document-share-link-design.md\`, \`docs/superpowers/specs/2026-09-14-phase-3-identity-workspace-governance-design.md\`, \`README.md\`, \`README.zh-TW.md\`; create \`docs/superpowers/verification/2026-10-09-shared-personal-document-inline-review.md\`.

**Interfaces:** No new production API. Preserve the one caller-less **document-content** entry: \`DocumentShareService.readShared(token)\`. Authorized review APIs may use token **plus caller** to persist review rows and return a bounded current-revision quote projection only.

- [ ] **Step 1: Add failing regression guard tests.** Assert review routes never access \`repositories.revisions\` directly, never return current Markdown/history/tree by token, and do not create new caller-less content functions; check a forged client identity has no effect; assert existing shared-reader tests continue to pass.
- [ ] **Step 2: Run red.** \`npm run test:unit -- tests/unit/share-link-single-exception.test.ts\` with strict assertions before changing guard/implementation; document that pre-change guard is not deleted wholesale.
- [ ] **Step 3: Revise contracts precisely as spec §13.** Update share-link spec non-goals/read path/API/Gateway warning and §15 checklist, Phase 3 §13 bearer grant, \`CLAUDE.md\`, README translations/share dialog copy. Write verification record with **observed** commands, actual pass/fail, known limitations and company deployment blockers. Revisit migration 017 availability after rebase onto newest main.
- [ ] **Step 4: Run complete verification.** \`make verify && make test-integration && make test-e2e\`; expected all pass **only when actually observed**. Also run E2E on both desktop/mobile and the original anonymous share-link route; inspect SQL audit payload to ensure no body, quote, token or hidden reason. If environment cannot run Docker/Playwright, mark the respective checks **NOT RUN**, provide blockers and do not call the work production-ready.
- [ ] **Step 5: Commit.** \`git add CLAUDE.md README.md README.zh-TW.md docs/superpowers tests/unit/share-link-single-exception.test.ts && git commit -m "docs(review): align security contracts and record verification"\`.

## Release, rollback and handoff

**Milestone A — schema/domain:** Tasks 1–4. DB is backward compatible; writes remain disabled. Gate: migration and repository tests with real MariaDB; no anonymous behavior change.

**Milestone B — secured backend:** Tasks 5–8. Default \`KM_REVIEW_WRITES_ENABLED\` is false. Gate: idempotency race tests, stale revision, revoked link, cross-document scope, audit privacy, Origin/CSRF and no Company SSO fallback. If disabled, owner moderation must remain available for incident response to existing records.

**Milestone C — product UI and evidence:** Tasks 9–11. Gate: reviewer/owner E2E, keyboard/mobile, Folder Sync, \`make verify\`, full integration and full E2E; report exact observations. Can merge behind a **disabled** production feature flag; do not turn on corporate commenting merely because local test identities work.

**Milestone D — separate company-only release (NOT executed by this plan):** Implement deployment-approved Gateway passive/optional auth for exact \`/api/share-review/*\` and login-start; strip all untrusted client identity headers, verify session and private upstream provenance, never send IdP redirects to fetch; implement verified \`CompanySsoSessionReader\` and top-level \`POST /auth/review/start\` nonce/cookie, protected continuation, 5-minute single-use return; validate with actual Gateway/IdP including 401 vs 302, forged headers, cookie replay, masked token logs, offboarding and link revocation. Save sanitized Gateway configuration and E2E evidence **before** setting \`KM_REVIEW_WRITES_ENABLED=true\` in company production.

**Rollback:** stop new writes with the admin-controlled flag first; keep reads and owner hide enabled, rollback UI/API to prior build if needed; preserve additive tables/audit rows by default. Hiding a secret is not physical erasure; follow separate security incident handling for accidental disclosure. No destructive automatic DB down migration.

**Execution method:** review the plan, then choose *subagent-driven* (recommended due to cross-cutting security and concurrent DB behavior) or *native* execution. Implementation begins only after review. Work from an isolated branch/worktree via \`superpowers:using-git-worktrees\`; TDD per task; fresh review and evidence for each task; final whole-branch review before merge.

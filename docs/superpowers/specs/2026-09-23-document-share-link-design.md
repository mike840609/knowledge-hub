# Document share links — design specification

| Item | Content |
| --- | --- |
| Date | 2026-09-23 |
| Type | Design specification for pre-implementation review |
| Scope | Read-only links for individual My Space documents (`/s/:token`); possession grants reading without sign-in |
| Contracts amended | `CLAUDE.md` “Knowing an ID is not authorization” and Phase 3 §13 “Workspace-only authorization boundary”; see §3 |
| References | Phase 3 governance, Phase 2.5 §24.1, action model, `frontend-design-language.md` |
| Status | **Decided (§12) and implemented.** Plan: `docs/superpowers/plans/2026-09-23-document-share-link.md`; verification: `docs/superpowers/verification/2026-09-23-document-share-link-verification.md` |

## 1. Problem

The product is personal-first: sign-in defaults to My Space, where most knowledge starts. My Space is deliberately single-user: `assertPersonalMutationAllowed` blocks membership/group operations. Consequently there is **no way to show someone else a document in My Space**.

Existing and planned entry points do not meet this lightweight sharing need:

| Entry point | Status | Why it does not fit |
| --- | --- | --- |
| Team Workspace | Implemented | Requires `workspace.create_team`, restricted by SSO group; a governance unit for lasting collaboration rather than temporary sharing |
| Promote (Phase 3 §18) | One specification sentence | Copies a new document into Team governance; too heavy for a quick read and the copies diverge |
| External publishing (Phase 6) | Not designed | Formal, durable, curated organization-wide publication |
| Inspector `Copy` | Implemented | Copies an **ID**, which does not grant access; recorded in action model §2 |

Add a fourth entry point: **an owner-issued, expiring, revocable read-only link**. Anyone holding it can read the document's current revision **without signing in**, and nothing else.

Responsibilities:

```text
Show someone my document        → Share link (this specification): no copy, current, temporary
Hand maintenance to a team      → Promote: copy, different governance
Publish formally organization-wide → External publishing (Phase 6): curated, durable, formal
```

## 2. Non-goals

- **Team documents:** v1 supports only My Space (§11).
- **Editing or comments through the link:** read-only.
- **Named invitations** such as sharing with Alice: Document ACL, explicitly excluded in Phase 3 §2.
- **Revision snapshots:** always current content (§5.3).
- **Live push:** after owner updates, readers refresh; no WebSocket/SSE.
- **Extending expiry:** create another link for a longer period.
- **Email or in-app notifications.**
- **API/MCP token reads:** only `/s/:token` accepts the token.
- **Classification preventing sensitive shares:** no classification system exists (§14).

**Network reachability determines who can obtain content.** With no login required, “link holder” means a holder who can reach the Hub host. An internal deployment limits reach to that network; an externally reachable deployment extends it to the internet. This is a deployment decision, unchanged here, but §15 requires explicitly recording it.

## 3. Contract amendments

This is the most consequential review section: it amends an invariant listed as easy to break in `CLAUDE.md`, with an exception requiring **no identity**. The documentation workflow requires recording canonical-spec deviations instead of introducing them silently.

### 3.1 Why this is not reading by ID

The existing invariant prevents guessing or incidental identifiers in URLs/logs, generated for identification rather than authorization, from becoming authority. Share tokens differ in every respect:

| Property | Document ID | Share token |
| --- | --- | --- |
| Purpose | Identification | Authorization |
| Issued by | System on document creation | Owner's explicit action |
| Guessability | UUIDv7 with 48-bit timestamp | UUIDv4 with 122 random bits |
| Entity relationship | Entity primary key | Independent field, not derived from any entity ID |
| Lifetime | Permanent | Required, at most 90 days |
| Revocation | None | Anytime |
| Audit | None | Governance events for issue/revoke, anonymous view counts |
| Accepted by | Read services with membership | **Only** `/s/:token` read path |

Retain the invariant but **write its sole exception**, or future readers of `CLAUDE.md` will reasonably consider this feature a violation.

### 3.2 Updated `CLAUDE.md` wording

After the decision, the implementation PR changes the invariant to:

> - **Knowing an ID is not authorization.** Possessing a `workspace_id`,
>   `source_id` or `document_id` grants nothing. URL parameters are navigation
>   inputs, never authorization proof, and the application service must
>   re-verify policy regardless of what the UI allowed. A UI selector is not an
>   access check.
>   The single bearer grant is a **document share link**
>   (`docs/superpowers/specs/2026-09-23-document-share-link-design.md`): an
>   unguessable (random UUIDv4, never derived from any entity ID), expiring,
>   revocable token that the document's owner issues on purpose. It requires
>   no sign-in. It is accepted by
>   exactly one read path (`/s/:token`) and grants whoever holds it the current
>   revision of one document — never search, tree, history, MCP, or any write.
>   No other code path may serve document content without a caller.

### 3.3 Phase 3 §13 amendment

§13 says Phase 3 provides no Source/Document ACL and different membership requires another Team Workspace. Add:

> **Exception (2026-09-23):** a document share link is an expiring, single-document, read-only bearer grant without login, not an ACL. It names no recipient, expands no Workspace capability, and does not participate in `evaluateEffectiveCapabilities`. See this specification.

The §2 non-goal excluding Source/Document ACL remains: a share link is not a named ACL entry.

## 4. User flow

**Owner:**

```text
My Space document row → right-click (or ⋯ or ⌘K) → Share link…
→ Dialog:
    Anyone holding this link can read this document without signing in.
    They will see your future changes, but cannot edit or view other My Space content.
    Share only content you are comfortable having forwarded.
    Optional label, for example “Backend group”
    Expiry: 1 / 7 / 30 (default) / 90 days
    [Create link]
→ Full link and [Copy]
→ Lower half lists all document links: label, creation, expiry, views, [Copy], [Revoke]
```

Copy only on the user's click, not automatically when the creation response arrives: after a network round trip, some browsers reject clipboard writes without a current user gesture. Show a read-only full-link field for manual selection/copy if clipboard access fails. Reopening the dialog always permits copying the same link.

**Reader:**

```text
Open link → /s/:token without SSO or a Hub account
→ Single read-only page: title, Markdown, shared-by owner, updated time, expiry
→ Refresh after owner updates to see current content
→ Any invalid condition → uniform “Link unavailable” page (§6.3)
```

## 5. Domain rules

### 5.1 Creation

The authenticated owner must satisfy all conditions:

1. Document and its Source exist and are `ACTIVE`.
2. Derived Workspace (`Document → Source → Workspace`) is `PERSONAL`, with `personal_owner_user_id = caller.identity.id`.
3. Workspace `lifecycle_state = ACTIVE`.
4. Fewer than **10** currently valid, unrevoked, unexpired links for this document.
5. `expiresInDays ∈ {1, 7, 30, 90}`; optional label at most 200 characters.

**`SOURCE_MANAGED` / `HUB_MANAGED` ownership does not affect sharing.** Sharing is reading; ownership determines writing. Explicitly exclude ownership from these conditions to avoid conflating them, as required by `CLAUDE.md`.

### 5.2 Validity, re-evaluated on every view

All conditions must hold. Any failure is uniformly unavailable:

1. Token exists.
2. `revoked_at IS NULL`.
3. `expires_at > now`.
4. Document is `ACTIVE`.
5. Source is `ACTIVE`.
6. Workspace lifecycle is `ACTIVE`.
7. **Issuer still has document read access**, re-evaluated using their **direct membership**. For PERSONAL, the `OWNER / SYSTEM_PERSONAL` row must still exist.

Reader identity is **not** a condition. Do not call `establishTrustedCaller` or read SSO session.

Condition 7 uses direct role because group grants depend on validated group IDs from the issuer's current session, unavailable during anonymous reads. In PERSONAL v1 this makes no difference, but helps explain deferring Team (§11).

Implement validity as a pure function under `modules/knowledge/domain`, without I/O, so every condition has an isolated unit test.

### 5.3 Current revision (decided)

Always resolve `current_revision`. After each owner save creates a revision, the next reader load sees it.

- Deliberate: readers should see the owner's current document, including typo corrections.
- No caching: §6.4 `Cache-Control: no-store` forces re-read on refresh.
- No live push (§2).
- **Cost:** every future addition becomes visible to link holders. The dialog explicitly explains this (§4).
- **No history exposure:** show only current title/Markdown, not revision list, metadata, `createdBy`, source name, or tree location.

### 5.4 Revocation

- Only the issuer may revoke.
- Final: never clear `revoked_at` after writing it.
- Per action model §6, consequential actions without undo use two-step inline confirmation, rather than act-then-undo.

### 5.5 No hard deletion

Keep link rows and view counts forever; expiry/revocation are states, preserving lifecycle invariants.

## 6. Read path

### 6.1 Sole entry point

```text
GET /s/:token (server component, outside /w/ layout)
  → No establishTrustedCaller: anonymous readers are intentional
  → shareLinks.readShared(token)
       ├─ Invalid UUID format → unavailable, no DB query
       ├─ Unique-index token lookup
       ├─ Read link, document, source, workspace, issuer direct membership
       ├─ Apply §5.2 pure predicate
       ├─ Increment view count (§7.2), separate transaction; log failure only (A5)
       └─ Return { title, markdown, sharedByName, updatedAt, expiresAt }
  → Any error → uniform page (§6.3), HTTP 404
```

`readShared` takes **no caller**, and never calls `workspaceAccess.requireMembership`. It must be the **only** content-returning method without a caller in the codebase, tested under §13.

**Composition:** constructing `DocumentShareService` for this route must bypass identity-provider construction and production readiness. Existing `applicationServices()` throws during construction in `company-sso` mode without a session reader (`identity-provider-factory.ts`), so provide a composition-root entry wiring only unit of work and sharing. E2E opens the link on `phase3UnconfiguredOrigin()` without an SSO reader to prove it.

**Deployment:** an SSO gateway/reverse proxy preceding the app must allow exactly these prefixes:

- `/s/*`, the share page.
- `/_next/static/*`, build-time CSS/JS/fonts needed for styles and browser timestamp conversion. Allowing only `/s/*` yields unstyled anonymous pages. This static prefix contains no user data.

Do not allow every path beginning with `/s`, all of `/_next`, or `/api`. Those broaden anonymous entry. Other application routes still establish trusted callers, but that should not be the sole defense.

### 6.2 No expansion to other read surfaces

No Workspace capability is granted. These hold without other code changes, but each needs assertions:

- A link-holding Hub user's Phase 4 search does not reveal this document.
- Their workspace selector does not show the issuer's My Space.
- The same document ID under `/w/:workspaceId/knowledge/...` or `/api/documents/:id` still returns 404.
- Future MCP (Phase 7) and retrieval (Phase 8) inherit Workspace policy, not share links.

### 6.3 Invalid page

Missing, revoked, expired, archived, or no-longer-authorized links use the same page and HTTP 404:

```text
This link is unavailable
It may have expired, been revoked, or never existed. Contact the person who shared it if you need the document.
```

Follow Phase 2.5 §24.1's non-disclosure rule. Anonymous response differences must not distinguish formerly valid from never-existing links.

### 6.4 Response headers

Add for `/s/:path*` in `next.config.ts`:

| Header | Value | Reason |
| --- | --- | --- |
| `Referrer-Policy` | `no-referrer` | External links must not leak the token through `Referer` |
| `Cache-Control` | `private, no-store` | No cached content after revocation; refreshing reads owner updates (§5.3) |
| `X-Robots-Tag` | `noindex, nofollow` | Discourage search engines and internal crawlers |
| `Content-Security-Policy` | `img-src 'self'; frame-ancestors 'none'` | Prevent iframe embedding and retain global image restrictions |

Retain `markdown-image-policy`. CSP must be **one header containing both directives**: Next.js keeps only the last matching rule for a key, so setting only frame-ancestors would override global `img-src 'self'` (Issue #20) on the sole anonymous page. E2E asserts the full header.

### 6.5 Page

- Single-column reading using existing `MarkdownRenderer`; no app shell, tree, selector, or inspector.
- **No Hub entry links:** most readers have no account; linking `/` sends them to SSO.
- No Open Graph/Twitter card tags: chat previews should not expose body summaries (§14-3). `<title>` remains the document title.
- Relative/internal Hub links return 404 for these readers; correct behavior, no rewriting.
- Follow `frontend-design-language.md` tokens and `globals.css` color variables.

## 7. Data model

Add migration `011-document-share-links`.

### 7.1 `document_share_links`

```sql
CREATE TABLE document_share_links (
  id           UUID        NOT NULL,
  document_id  UUID        NOT NULL,
  token        UUID        NOT NULL,   -- UUIDv4; see §8
  label        VARCHAR(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  created_by   UUID        NOT NULL,
  created_at   DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  expires_at   DATETIME(6) NOT NULL,
  revoked_by   UUID        NULL,
  revoked_at   DATETIME(6) NULL,
  PRIMARY KEY (id),
  CONSTRAINT uq_share_links_token UNIQUE (token),
  CONSTRAINT fk_share_links_document  FOREIGN KEY (document_id) REFERENCES knowledge_documents(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_share_links_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_share_links_revoked_by FOREIGN KEY (revoked_by) REFERENCES users(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT ck_share_links_expiry  CHECK (expires_at > created_at),
  CONSTRAINT ck_share_links_revoked CHECK ((revoked_at IS NULL) = (revoked_by IS NULL)),
  KEY idx_share_links_document (document_id, created_at)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

**Do not store `workspace_id` or `source_id`.** Scope is derived from Document → Source → Workspace, never duplicated into potentially inconsistent copies.

### 7.2 `document_share_link_views`

Readers are anonymous; record **counts**, not identity:

```sql
CREATE TABLE document_share_link_views (
  share_link_id   UUID        NOT NULL,
  view_date       DATE        NOT NULL,   -- UTC
  first_viewed_at DATETIME(6) NOT NULL,
  last_viewed_at  DATETIME(6) NOT NULL,
  view_count      INT UNSIGNED NOT NULL,
  PRIMARY KEY (share_link_id, view_date),
  CONSTRAINT fk_share_views_link FOREIGN KEY (share_link_id) REFERENCES document_share_links(id) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

Each view executes `INSERT … ON DUPLICATE KEY UPDATE last_viewed_at = …, view_count = view_count + 1`.

**No IP, User-Agent, or identifying reader data.** Personal data would need separate retention/access rules and cannot reliably identify readers of forwarded anonymous links. Usage/frequency counts suffice for deciding whether to revoke.

**Not `workspace_audit_events`:** that table holds one row per governance mutation for Team OWNER/ADMIN audit. High-frequency reads would overwhelm it, and My Space has no Audit page (Phase 3 §17).

### 7.3 Governance events

Create/revoke still write `workspace_audit_events` **in the mutation transaction**, per Phase 3 §16:

| `event_type` | `target_type` | `target_id` | `payload` |
| --- | --- | --- | --- |
| `DOCUMENT_SHARE_LINK_CREATED` | `DOCUMENT_SHARE_LINK` | link id | `{ documentId, expiresAt, label }` |
| `DOCUMENT_SHARE_LINK_REVOKED` | `DOCUMENT_SHARE_LINK` | link id | `{ documentId }` |

Derive `workspace_id` at write time. Never include tokens in payload: audit readers need not own the link and must not obtain working links from it.

## 8. Token

- Generate with `crypto.randomUUID()`: UUIDv4, 122 random bits, `/s/<token>`.
- **Never use the usual `uuidv7()` for tokens.** Link primary key `id` remains UUIDv7, but tokens cannot, in descending severity:
  1. **Sequential within a millisecond.** `src/shared/ids/uuidv7.ts` increments the preceding random portion for monotonicity. Creation sequentially issues link ID, token, and audit ID in one transaction; measured endings `…d31e`, `…d31f`, `…d320` allow deriving the token from an ID visible in revoke URLs/logs/audit. Different users in one process/millisecond can also receive adjacent values.
  2. A 48-bit timestamp reveals issue time and leaves at most roughly 74 random bits.
  3. Tokens resemble normal IDs and may be logged or placed in payloads accidentally.

  UUIDv4 costs poorer index locality, negligible for this table. Test consecutive links for token difference not equal to 1 and version equal to 4.
- Store plaintext in independent native MariaDB `UUID` token column with unique index.
- Owners can copy the same link whenever needed.
- New `ShareTokenIssuer` port supplies generation; domain/application do not directly depend on `node:crypto`, and tests inject values.

Without login, the token is the **sole** defense. No owner-chosen slugs or shortening.

**Why plaintext rather than hash-only:** hashes prevent copying a link after creation, forcing a new link for every later share, contrary to the dialog workflow. Database readers can already read all content; plaintext additionally gives access to future updates, bounded by expiry/revocation. Hash/key management is not justified here (A3).

Keep at most 10 active links per document, allowing separate recipients' links, revocation, and view counts.

## 9. Application and HTTP

### 9.1 Module

Use `knowledge`: sharing is another authorization path for reading a document. `KnowledgeRepositories` already has `workspaces`, `workspaceMemberships`, and `sourcePolicy`, allowing §5 checks without violating lint boundaries. Add no fifth module.

```text
src/modules/knowledge/domain/document-share-link.ts          Entity, §5.1/§5.2 predicates, errors
src/modules/knowledge/ports/document-share-link-repository.ts
src/modules/knowledge/ports/share-token-issuer.ts
src/modules/knowledge/application/document-share-service.ts   create/list/revoke/readShared
src/infrastructure/database/mariadb/repositories/document-share-links.ts
src/infrastructure/database/mariadb/migrations/011-document-share-links.ts
src/server/share-read.ts                                      /s/:token read projection
src/server/composition.ts                                     Wiring
```

### 9.2 Service interface

```ts
interface DocumentShareService {
  create(caller, { documentId, label?, expiresInDays }): Promise<ShareLinkView>; // Includes path
  list(caller, documentId): Promise<ShareLinkView[]>; // Includes path and daily view counts
  revoke(caller, linkId): Promise<void>;
  readShared(token): Promise<SharedDocumentView>; // No caller: sole content read without membership
}
```

Create/list/revoke require authenticated caller and §5.1-2 My Space ownership; accept no client-supplied workspace ID.

`readShared` deliberately accepts no `CallerContext`. An incidentally signed-in reader must not change outcomes, complicating tests or giving different behavior for the same link.

### 9.3 Lock order

Create/revoke follow Phase 3 §14.2's non-import existing Source path:

```text
Source FOR UPDATE → Workspace FOR UPDATE → Recheck §5.1 → Insert/update link + audit
```

This matches re-sync and avoids inversion. `readShared` takes no row lock: recheck §5.2 every time; if archived just after reading, the next view is invalid.

### 9.4 Routes

| Method | Path | Sign-in | Response |
| --- | --- | --- | --- |
| `POST` | `/api/documents/:documentId/share-links` | Yes | `201 { link }`, `link.path = /s/<token>` |
| `GET` | `/api/documents/:documentId/share-links` | Yes | `200 { links }`, each includes `path` |
| `POST` | `/api/share-links/:linkId/revoke` | Yes | `204` |
| `GET` | `/s/:token` | **No** | Page; all invalid links return 404 |

Return paths, not full URLs: reverse-proxy Host may differ from public origin and can be forged. Browser uses `window.location.origin`.

Use POST revoke, not DELETE: no hard deletion is implied.

Reuse `http-error-response.ts`: missing/inaccessible document → 404; non-PERSONAL, archived document, or over 10 links → 409 with explicit reason.

## 10. UI

### 10.1 Action registry

All surfaces use `action-registry.ts` per action model. Add:

```ts
{
  id: "document.share",
  label: "Share link…",
  group: "document",
  icon: "share",
  keywords: ["link", "share", "copy link", target.label],
  surfaces: ["palette", "row"],
  effect: { kind: "command", command: "document.open-share", documentId, sourceId },
}
```

Availability across action model §4.1's axes:

1. **Workspace capability:** `workspaceType === "PERSONAL"` and `confirmed`.
2. **Source ownership:** **not checked**, per §5.1.
3. **Target:** `status === "ACTIVE"` and `revision === "CURRENT"`. Offering share on history misleadingly implies snapshot sharing. Status incorporates source state; an ACTIVE document in an archived source is effectively ARCHIVED because §5.1-1 rejects creation.

`available()` controls display, service controls execution; §13 asserts both separately.

Header also uses the registry action beside Edit. Icon-only with “Share link…” label/tooltip: no header Copy link ambiguity, and the dialog explains consequences before creation. Use `Share2`, not chain icon already used by Copy link beside it in row menus.

### 10.2 Wording

Use “Share link…”, not “Share”, which elsewhere suggests invitations/edit grants. This action only creates a read-only link; ellipsis indicates a dialog.

Dialog must explicitly say **no sign-in** and **future changes are visible** (§4). This is the owner's available risk information; do not omit it for brevity.

### 10.3 Feedback

- Create success displays link/Copy in dialog, without an additional toast, consistent with action model §6's result-oriented feedback.
- Revoke success shows toast without undo (§5.4).
- Failures stay beside dialog controls.

## 11. Why Team sharing is deferred

Three decisions should not be incidental v1 choices:

1. **Governance bypass:** Team OWNER/ADMIN controls membership. Any EDITOR issuing anonymous links would bypass governance. Need OWNER-controlled Workspace setting such as `shareLinksAllowed` and issuer authority rules (`document.write`? ADMIN+?).
2. **Issuer authority cannot be evaluated offline:** §5.2-7 sees only direct role. Group-derived Team access cannot be rechecked without issuer session. Either require direct role or accept continued validity after group removal until expiry.
3. **Audit visibility:** Team OWNER/ADMIN should inspect/revoke member links through Audit, adding governance authority.

Write a separate specification after v1 usage evidence (A6).

### 11.1 Suggested phase-2 starting point (undecided)

These are proposals, **not this specification's decisions**, and require fresh review:

| Question | Proposal |
| --- | --- |
| Team availability | OWNER-controlled setting, off by default |
| Issuers | Members with **direct role** and `document.write` (EDITOR+); group-only members excluded |
| Revocation | Issuer and Team OWNER/ADMIN |
| Link list | OWNER/ADMIN sees all; others see their own |
| Audit | Create/revoke events in Team Audit |
| Automatic invalidation | Issuer removed or loses read access (§5.2-7 already covers it) |

No extra link-model fields are needed: links store no scope, settings belong to `workspaces`, and issuer/revoker fields already exist.

## 12. Decisions

All decided; no open decisions.

### Confirmed 2026-09-23

| # | Decision | Content |
| --- | --- | --- |
| A0 | Audience | General developer knowledge sharing, not a specific sensitive-data domain; no global flag; view counts are statistics, not audit |
| A1 | Anonymous reads | Possession grants reading without SSO/account; impacts §2, §6.1, §7.2, §14 |
| A2 | Current content | Refresh sees updates; no snapshots or live push (§5.3) |
| A3 | Token | Random UUIDv4, plaintext independent unique field, repeatable owner copying (§8) |
| A4 | Expiry | Required 1/7/30/90 days, default 30 |
| A5 | Count-write failure | Fail open: independent transaction, log without token, still display content |
| A6 | Staging | My Space first; specify Team later using first-wave usage evidence (§11) |

## 13. Acceptance criteria

**Domain, unit without DB**

- Each §5.2 condition has a case where only that condition fails.
- Each §5.1 condition has a refusal case; `SOURCE_MANAGED` sharing **succeeds**.
- Registry offers `document.share` only for PERSONAL/ACTIVE/CURRENT; exclude TEAM/ARCHIVED/HISTORICAL/unconfirmed.

**MariaDB integration**

- Reject nonowners, Team documents, archived documents, and the 11th link without link/audit writes.
- Create/audit share one transaction; simulate audit failure and assert no link.
- Tokens have version 4 and differ from row/document IDs; audit payload excludes token.
- Invalid UUID routes return unavailable without any DB query.
- Revoke, expiry, resync archive, and source archive all make `readShared` fail.
- Count-write failure still returns content.
- New owner revision returns new content.
- Three views in one day create one row with `view_count = 3`; no identifying columns.
- Concurrent re-sync Apply/create avoids deadlock.

**Non-expansion, integration or E2E**

- Another signed-in link holder cannot find document in search/selector or read it through `/w/.../knowledge/...` or `/api/documents/:id`; both 404.
- Scan programmatically: all public knowledge methods returning revision content except `readShared` accept `CallerContext` and require membership or `requireVisibleDocument`.
- Sample route classes without session; every page/API outside `/s/*` fails.

**Playwright E2E**

- Owner row Share link → create → open in **session-free context**, showing content/shared-by.
- Owner edit → anonymous refresh shows new content.
- Two-step revoke → anonymous refresh gets uniform unavailable page/404.
- Assert all four §6.4 headers and absence of Open Graph tags.

## 14. Known limitations

1. **Anyone with the link can read, including former employees.** No login means SSO offboarding cannot identify/block readers. Issuer offboarding also leaves links alive until expiry. Required expiry (A4) and owner revocation are the mitigations.
2. **Forwarding is unbounded.** External forwarding is limited only by network reachability (§2). Counts can reveal unexpected frequency, not identity.
3. **Chat previews fetch pages.** Slack/Teams servers fetch the page, expose document `<title>` in chat, and count a view. No Open Graph tags (§6.5) prevents supplied body-summary previews, but title remains.
4. **URL tokens** enter browser history and potentially proxy access logs. Mask `/s/` paths in deployment.
5. **No classification:** system cannot identify/prohibit sensitive shares. Sharing should be an early integration point if classification is added.
6. **Relative links/images do not work for these readers:** assets are metadata-only and internal documents remain inaccessible.
7. **No application rate limiting:** 122 random bits prevent practical guessing, but anonymous requests can still flood the endpoint. Enforce limits at gateway (§15).

## 15. Documents and settings to update after decision

**Documentation, in the same implementation PR to prevent drift:**

- `CLAUDE.md`: §3.2 wording.
- Phase 3 §13: §3.3 exception.
- README canonical table: this specification and plan.
- `frontend-design-language.md`: update together if share icon/reader needs tokens.

**Deployment checklist**, outside code scope but required before rollout, recorded in `docs/superpowers/verification/`:

- [ ] SSO gateway allows only `/s/*` and `/_next/static/*`, with login on other paths; attach configuration (§6.1).
- [ ] Record internal/external network reachability; externally reachable links are internet-readable.
- [ ] Mask tokens after `/s/` in proxy access logs.
- [ ] Gateway rate-limits `/s/*`.
- [ ] Security stakeholders know this anonymous read path exists.

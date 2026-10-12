# Saved shares in My Space

## Intent and agreed product direction

Users need a durable place to return to articles other people shared with them.
These articles remain controlled by the sender's expiring, revocable share link.
Saving a link must be distinct from favoriting a document owned by the reader's
My Space. The user requested implementation of the previously discussed design:
two sections in Shares and a bookmark action on the public article reader.

Success means a signed-in user can save a live share, find it on another device
under Shares, open its latest available content, and remove it even after the
link stops working. Workspace favorites, document counts, search, and revisions
do not gain entries for saved shares.

## Existing contracts

- `/s/:token` is an anonymous reader. It resolves no workspace links or trees.
- `DocumentShareService.readShared` validates the token, document, source,
  workspace lifecycle, and creator's direct access before serving the current
  revision. It counts an actual public read separately.
- Shares currently manages links issued by the owner of an active personal
  workspace. Team workspace sharing is outside this change.
- Personal favorites require a document inside the caller's own personal
  workspace; this authorization must remain intact.
- Repository-wide scope and caller requirements in `CLAUDE.md` remain binding.
- Production authentication depends on the deployed trusted identity adapter.
  This feature does not create a login provider or assume an automatic login
  continuation that the current application does not implement.

## Approach and alternatives

Use a dedicated saved-share relation and caller-scoped application service in
the existing knowledge module. Reference the share-link entity, not a copied
document or a general external URL. This preserves the original bearer grant
and keeps recipient-specific data out of the ordinary favorites flow.

Extending favorites would mix ownership and authorization models, contrary to
the user's request. Browser-only bookmarks would fail the cross-device goal.
Copying documents would create independent content that survives revocation and
would not follow later revisions. These alternatives are excluded.

## User experience

### Public article reader

- Add a labeled bookmark button: `Save share` / `Saved` (Chinese guide wording:
  儲存分享 / 已儲存). Use the bookmark icon rather than a favorite star.
- The public server-rendered article remains anonymous. A client control checks
  the current user's saved state through an authenticated, private endpoint.
  Authentication failures must not make the public article unreadable.
- Clicking Save while signed out explains that sign-in is required, with the
  existing explicit `/s/:token/open` application entry available. No anonymous
  save, automatic write after login, or new authentication scheme is introduced.
  If authentication is unavailable, show that condition rather than claiming a
  successful save. Returning to the article allows the user to retry saving.
- Disable duplicate actions while pending. Show success only after the server
  confirms persistence; failure keeps the prior state and offers retry.
- Success feedback includes a link to the user's Shares saved section:
  `Saved to Shares`. The response derives that personal workspace from the
  trusted caller, never from a client-supplied destination.
- A saved button can remove the bookmark. Removal does not revoke the sender's
  link. Both controls have visible labels, accessible state, and keyboard focus.

### Shares page

- Keep the existing sidebar entry and page. Add two route-backed sections:
  `My shares` and `Saved shares` (我分享的 / 已儲存的分享).
- `/w/:workspaceId/shares` defaults to My shares, preserving current links,
  filtering, pagination, copying, statistics, and revocation behavior.
- `/w/:workspaceId/shares?tab=saved` selects Saved shares. Navigation identifies
  the current section accessibly and is retained in search and pagination URLs.
- Saved rows display title, shared-by name, document update time when available,
  expiry, and saved time. They expose Open and Remove, with no sender-only
  revoke action or view statistics.
- Opening a saved share uses `/s/:token`, never the sender's workspace route.
- Valid rows show current public title, sender name, and update time. Expired
  or otherwise unavailable rows show only metadata captured when saved, with a
  clear unavailable state and no active article link. Expiry is already public;
  other invalidity reasons remain a generic `Link unavailable`, consistent with
  the existing public-reader contract. Do not disclose why access was revoked
  or which private entity was archived.
- Availability is checked whenever the list is requested. The public reader
  independently checks again when Open is used, handling revocation between
  list display and click. Refresh is available.
- Support title/sender keyword filtering, All/Available/Unavailable filtering,
  and bounded pagination (50 rows). Order newest saved first with a stable ID
  tie-breaker. Search considers saved metadata plus currently valid public
  metadata; invalid links cannot reveal later title or sender changes.
- Empty-state copy explains that users can save articles from a share page.
  A filtered empty state offers Clear filters. Follow the existing compact row,
  illustration, typography, color, mobile, and keyboard-navigation contracts.
- Keep ordinary favorites, Home updates, search, and Insights statistics
  unchanged. Update the in-app English and Chinese guide to explain the two
  destinations and the access lifetime of a saved share.

## Persistence and application boundary

Introduce a MariaDB migration for `saved_document_shares` with:

- UUID `id`, `user_id`, and `share_link_id` with restrictive foreign keys;
- unique `(user_id, share_link_id)` so repeated saves are idempotent;
- `saved_title`, `saved_shared_by_name`, and `saved_expires_at` captured only
  after successful live-token validation, allowing an unavailable row to remain
  recognizable without retaining article bodies or accessing later metadata;
- `saved_at`, `updated_at`, and nullable `removed_at`, following the existing
  soft lifecycle rather than introducing end-user permanent deletion;
- an index serving recipient-owned active rows in saved-time/ID order.

No document workspace/source scope is duplicated on this relation. The user's
personal workspace is an authorized presentation destination, not ownership of
the shared document. Store no Markdown, attachments, revisions, copied content,
or token in this relation. Resolve the token from its share-link foreign key
only for the owning recipient's valid navigation response.

Add a saved-share port, MariaDB adapter, and application service through the
existing unit-of-work/composition patterns. Every public service entry takes a
required `CallerContext`. Save validates a live token with the same domain rule
as the public reader, but does not call the caller-less reader or count a view.
Validity inputs, current public title, and sender name must be captured by one
consistent SQL read; separate reads under READ COMMITTED could snapshot a title
published privately after revocation. Save evaluates the captured grant and
persists only metadata from that same view.
List checks link validity without serving Markdown or counting views. Batch
load candidate validity/public metadata for bounded pages to avoid one complete
public read per saved row. Keep the shared validity logic consistent; introduce
no additional anonymous service entry or web-layer repository access.

Save synchronizes the trusted user and checks the user's active personal
workspace. Deduplicate by share-link ID, not document ID: different links can
have independent expiry/revocation. Saving an already-active relation returns
its existing state. Re-saving a removed relation refreshes its saved metadata
and saved time. Removing an absent or previously removed own relation is
idempotent. A different user's saved-record ID returns not found.

## HTTP and privacy

- `GET /api/saved-shares/state?token=…`: caller-required private state lookup;
  no content returned. An invalid token is not a way to enumerate documents.
- `POST /api/saved-shares`: same-origin, caller-required save with token in JSON.
  Unknown, expired, revoked, or otherwise invalid shares return the same
  unavailable error. Client input cannot select the recipient account.
- `DELETE /api/saved-shares/:id`: same-origin, caller-required removal scoped to
  the trusted user; independent of whether the link is still live.
- `GET /api/workspaces/:workspaceId/saved-shares`: list available only to the
  owner of that active personal workspace, with validated query/pagination.
- Use existing trusted identity and configured public-origin checks. Return
  `Cache-Control: private, no-store` for all recipient-specific responses.
- Do not log tokens, payloads, or share URLs. Treat DB/transport failure as an
  error with retry, not a successful empty result or an unavailable link.
- No recipient identities or save counts are exposed to the sender. No new
  sender audit events or anonymous tracking are introduced.

## Verification and acceptance

1. Unit tests cover saved query validation, duplicate save/removal semantics,
   state transitions, generic invalidity responses, UI tabs/actions/errors, and
   the existing caller-less content boundary guard.
2. MariaDB integration tests use two independent users/workspaces. A live token
   allows saving without sender workspace membership; IDs alone do not. Other
   users cannot list/state-read/remove the recipient's records, and favorites
   still reject the sender's document. Concurrent saves create one relation.
3. Expiry, revocation, creator access loss, and document/source/workspace archive
   prevent new saves and content access. Saved rows remain removable and expose
   no later private metadata. Archive restoration can make a still-live link
   available again; expiry and revocation do not become access grants.
4. E2E exercises Save → Shares → Open → latest saved revision → Remove, saved
   state in a fresh authenticated browser context, unavailable rows after
   revocation, signed-out save feedback, and pending/network-failure recovery.
5. Verify the new caller-required endpoints' cross-origin rejection and private
   caching, without weakening existing shared-reader/review tests.
6. Run the repository's unit/typecheck/lint/build gates plus relevant database
   and Playwright suites. Capture demo-data screenshots of the share reader and
   Shares sections on desktop/mobile in light/dark; do not publish real tokens.

## Scope exclusions

No Team workspace feature, Collections, ordinary favorites change, content copy,
external-URL bookmarking, attachments, notifications, semantic search, MCP,
login provider, or automatic login-and-save continuation is included.

## Approval

The user approved this written design and then reviewed the implementation
plan, choosing inline execution in the current session. Implementation and
verification evidence accompany this specification.

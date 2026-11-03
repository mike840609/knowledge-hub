# Named-recipient share links

## Intent

Some My Space documents must be readable only by specific people. Today's share
link is a bearer grant: whoever holds the URL reads it, signed in or not, until
it expires. Owners who need access control have no way to say "only these
colleagues".

Agreed with the user on 2026-11-03:

- **A new kind of share: named recipients, permanent.** The owner picks people
  by employee ID or name, with the same autocomplete as discussion `@`
  mentions (`name`, `emp_id`, `name_en`). Several people per share.
- **Only those people can open it.** Signed in, and on the list. Anyone else
  holding the URL sees nothing.
- **No expiry.** It lives until the owner revokes it or removes a person.
- **Recipients find it without being handed a URL**: an Inbox entry ("X shared
  《doc》 with you") and a permanent place in their Shares list. The owner may
  also paste the URL to them.
- **Recipients can do what a link reader does today**: read, comment, discuss,
  `@` mention.
- **Only the owner adds people.** A recipient who mentions someone not on the
  list does not grant that person access.
- **Documents and My Space folders** are both supported, as today's links are.
- **It coexists with ordinary links.** A document with a named-recipient share
  may also have ordinary bearer links; each judges its own readers.
- **Removing a person** keeps the comments they wrote; their Inbox entries for
  that share name nothing, exactly as a dead link's do.

Success: owner O creates a named-recipient share on document D for A and B.
A's Inbox shows "O shared 《D》 with you"; A's Shares list shows D. A opens it,
comments, and cannot mention C (not on the list): C is not offered, and a
hand-built request naming C is refused, so C receives nothing; `/s/:token`
answers C with the same 404 a dead link gives. B opens the URL
signed out and is asked to sign in, then reads. O removes A: A's next request
is a 404, A's entries name nothing, A's comments remain in the discussion.

## Non-goals

- No recipient-to-recipient resharing, no "request access" flow.
- No Workspace membership, search, tree, history, MCP, Markdown edits or
  revision writes for recipients — the same exclusions every link carries.
- No teams/groups as recipients. Individuals only.
- No change to ordinary bearer links.

## Anti-goals (a failure even if it works)

- A non-recipient learns the share exists: any response that differs from a
  dead link's (status, title in `<title>`, metadata, timing-visible extra work
  is acceptable but content is not).
- Any caller-less path serves content of a named-recipient share.
- A mention, a saved share, a follow or a Shares-list entry becomes a back door
  that outlives removal or revocation.

## Model — chosen: a kind of share link, not a membership

Every discussion, mention, follow, saved-share and Inbox path is keyed on
`share_link_id` and enters through `/s/:token`. Making the named share a
`document_share_links` row reuses all of it, and the only new rule is one more
check where a link is judged open. A Workspace-membership design was rejected:
it grants tree, search, history and MCP, which CLAUDE.md forbids for shares.

Schema (one migration):

```text
document_share_links
  + audience  ENUM('LINK','NAMED') NOT NULL DEFAULT 'LINK'
  expires_at  becomes NULL-able; CHECK: (audience = 'LINK') = (expires_at IS NOT NULL)

document_share_link_recipients(
  share_link_id  UUID FK document_share_links
  user_id        UUID FK users
  added_by       UUID FK users
  added_at       DATETIME(6)
  PRIMARY KEY (share_link_id, user_id)
  KEY (user_id)
)
```

Removal deletes the recipient row (and writes an audit event). Revocation is
the existing `revoked_at`. Existing rows default to `LINK`; nothing about them
changes.

Domain: `DocumentShareLink` gains `audience: "LINK" | "NAMED"` and
`expiresAt: Date | null` (null iff NAMED). `shareLinkExpiry`,
`toView`, the Shares management list and every "open now" comparison must
treat null as never expiring.

## The judgement — every copy of it

"Does this link open now" exists in several copies
(`internal/folder-link-reach.ts:14-18` says so). Each must apply the NAMED rule
and treat a null `expires_at` as never expiring:

- `openShareLinkTarget` (share service reads);
- `linkOpens`, called by `DocumentReviewService.opens()` (review writes,
  follows, mentions, Inbox judgement);
- `SavedShareService.save`'s `evaluateShareLinkValidity` snapshot — the API
  refuses to save a NAMED link at all (hiding the button is not enough);
- the SQL filters on `expires_at > ?`: saved-shares list, owner's
  `listForWorkspace`, `listOpenFolderLinks`, and the active-link counts. Each
  becomes `(expires_at IS NULL OR expires_at > ?)`, plus the recipient join
  where a caller other than the owner is judged.

The rule:

- `LINK`: unchanged; caller ignored.
- `NAMED`: opens only when a caller is given **and** a recipient row exists for
  (link, caller.identity.id), **or** the caller is the link's creator. No
  caller → not open.

Every entry that judges a link passes the caller it has (or none). Failure is
always `ShareLinkNotFoundError`, indistinguishable from a dead link.

### The caller-less entries

CLAUDE.md names exactly three entries that answer without a caller:
`readShared`, `DocumentReviewService.queryForLink`, `readSharedTarget`. They
stay caller-less **for LINK**. `readShared` and `readSharedTarget` gain an
optional caller (`queryForLink` already takes `CallerContext | null`); for a
`NAMED` link with no caller all three refuse.
`tests/unit/share-link-single-exception.test.ts` is a source scan, not a
runtime test: its rules are updated so these three remain the only exceptions
with their new optional parameter. A new integration test asserts at runtime
that a NAMED link without a caller (or with a non-recipient) yields
`ShareLinkNotFoundError` from all three. CLAUDE.md's invariant paragraph is
amended in the same change.

### Where a NAMED share is read

Deployment constraint (user, 2026-11-03: assume it holds): the company Gateway
sends no identity on `GET /s/<token>`; that page is anonymous and stays so.
Identity reaches only protected routes (`/s/<token>/open`, `/w/*`,
`/api/share-review/*`, other APIs). So a NAMED share is **never rendered by
`/s/<token>`**:

- **`/s/<token>`** with a NAMED token answers exactly as a dead link does (same
  404 page, same metadata). The not-found page gains one neutral line for
  everyone, dead or NAMED alike: "If this was shared with you, open it in the
  Hub", linking to `/s/<token>/open`. Nothing distinguishes the two.
- **`/s/<token>/open`** (protected): for NAMED, establish the caller first, then
  judge; recipient or owner → redirect to the in-Hub reader; anyone else → 404.
  LINK keeps today's order (judge, then sign-in). Recorded deviation from the
  2026-10-29 folder-share spec, which gets an "Amended by" line pointing here.
- **In-Hub reader: `/w/<callerPersonalWorkspaceId>/shares/<token>`** (protected,
  inside the app shell; `?d=` for folders as today). It renders the same shared
  reading + review panel components as `/s/<token>`, fed by
  `readShared(token, { caller })`. The workspace segment is only the caller's
  own shell; a different id redirects to the caller's own.
- **URLs handed out**: the share dialog copies `/s/<token>/open` for NAMED
  shares; Inbox and Shares-list entries link to the in-Hub reader directly.

Builder must verify that `/w/*` and `/s/<token>/open` are Gateway-protected in
the company deployment as they are assumed to be here.

## Discussions and mentions

- Writes already require a trusted caller; they now also pass the NAMED check.
  Query reads (`/api/share-review/*` query) pass the optional caller.
- **Mention candidates** for a NAMED link: only its recipients and the owner.
  The server enforces this in `/api/review-mentions/candidates`; the composer
  just shows what comes back.
- **Writing a mention of a non-recipient through a NAMED link is refused**
  server-side (the write path checks each mentioned id against the recipient
  list, owner included as allowed). A stored dead entry would tell the person
  the share exists. (Claude's call.) A mention stored while the person *was* a
  recipient and later removed is judged per request and names nothing.
- **Owner mentions from the Workspace view:** `mentionLinksForOwner` offers a
  NAMED link only when the mentioned person is on its list. Mentioning is never
  a second way to add a recipient. (Claude's call.)
- **Re-adding a removed recipient** is a fresh add: a new "shared with you"
  entry; follows judge open again; mention entries already marked read while
  dead stay read. (Claude's call.)
- Follows, mention entries and follow-reply entries for a NAMED link are judged
  with the Inbox reader as caller. A removed recipient's entries name nothing.
- Comments by a removed recipient remain, attributed as today.

## Recipients find it

- **Inbox:** a new entry kind, "X shared 《title》 with you", created when a
  person is added (not on later edits). Unread until opened. Judged per
  request; after removal or revocation it names nothing, as a dead link's
  entry does. Clicking lands on the in-Hub reader `/w/<ws>/shares/<token>`.
- **Shares → Shared with me:** NAMED links where the caller is a recipient and
  the link opens now appear automatically, merged with the caller's saved
  shares, without the caller saving them. Unavailable ones are not listed
  (unlike saved shares, there is nothing the recipient chose to keep).
  The existing "Save" button is hidden for NAMED links (nothing to save).

## Owner management

- The share dialog gains a second mode, "Specific people": a recipient picker
  with mention-style autocomplete over all signed-in Hub users (`users` rows),
  showing name · emp_id · name_en, with the person's `org_code` beside it to
  tell namesakes apart (the candidate search therefore also answers `org_code`
  to signed-in callers; it decides no access). At least one recipient to
  create. No expiry control.
- The two modes are one choice of audience, a segmented radio group
  ("Anyone with the link" · "Expires · no sign-in", then "Specific people" ·
  "Permanent · sign-in required"), the link first and chosen by default: it
  needs nothing filled in and works for readers without a Hub account.
- After creation the owner can add and remove recipients, and revoke the whole
  share. Adding notifies the added person; removing notifies nobody.
- The owner cannot add themselves.
- Shares management (owner's list) shows NAMED shares with their recipient
  count and "No expiry".
- Limit: NAMED shares count toward `MAX_ACTIVE_SHARE_LINKS_PER_DOCUMENT`
  (folder equivalent likewise); recipients per share capped at 50
  (call: Claude's; adjust if needed).
- Audit events: created (with recipient ids), recipient added, recipient
  removed, revoked.

## Authorization summary

| Caller | LINK | NAMED |
|---|---|---|
| anonymous | reads, query discussion | same page as a dead link (with the neutral "open in the Hub" line) |
| signed in, not listed | reads, writes | 404 |
| signed in, listed | reads, writes | reads, writes |
| owner | reads, writes, manages | reads, writes, manages |

Nothing in either column grants Workspace membership, search, tree, history,
MCP, Markdown edits or revision writes.

## Tests the change must carry

- Domain: open-judgement table above, null expiry, recipient cap, owner-self.
- `share-link-single-exception`: NAMED without caller refused by all three.
- Integration: create/add/remove/revoke; readShared/queryForLink/readSharedTarget
  per row of the table; folder NAMED share re-derives the subtree; mention
  candidates restricted; removed recipient's Inbox entries and Shares entry
  name nothing / vanish while their comments remain.
- e2e: owner creates for A; A sees Inbox + Shares entry, opens, comments; B
  (unlisted) gets 404; anonymous `/s/<token>` for a NAMED share is byte-identical in title/status to a dead link.

## Left to the builder

- Exact UI copy and placement inside the existing share dialog (follow the
  frontend design language contract).
- How the optional caller is resolved on `/s/*` without forcing sign-in.
- Whether the Inbox entry is a new table or reuses an existing event table,
  provided it is judged per request.

## Deviations recorded during planning and build

Where the build differs from the text above, this section is the record.

1. **A removed recipient's "shared with you" entry disappears.** Removing a
   recipient deletes their row, so the Inbox and Shares entry is gone rather
   than present and naming nothing. A link that is revoked or expired while the
   person is still named does keep an entry that names nothing.
2. **A dead LINK token on `/s/<token>/open` reaches sign-in before its 404** when
   the visitor is not yet signed in. The route establishes the caller (needed
   for NAMED) before it can answer 404, so LINK's judge-first order no longer
   spares a signed-out visitor the sign-in step.
3. **"Shared with you" on the Shares page is its own section**, above the saved
   shares, not rows merged into that list. Its entries are not saved shares and
   offer no Save or Remove.
4. **Mentioning a non-recipient through a NAMED link is refused at write time**
   (`MENTION_NOT_RECIPIENT`). The owner's mention-link offers
   (`mentionLinksForOwner`) omit NAMED links when no mentioned ids are given,
   since such a link cannot be judged without them.
5. **List, add and remove on a revoked NAMED share answer not-found.** Removing
   the last recipient is allowed; the share then opens only for its owner.
6. **Shared views carry `linkId` only on NAMED reads.** It is used to mark the
   recipient's Inbox entry read when the share is opened; LINK reads do not
   carry it.
7. **The "optional caller" on share reads is a `viewerId: string | null`, not a
   `CallerContext`.** `readShared` and `readSharedTarget` take the viewer's id
   (null: no one signed in), threaded from
   `establishTrustedCaller().caller.identity.id`. `src/server/share-read.ts`
   (`getSharedForViewer`, `sharedOpenTarget`) is the only web-layer entry that
   passes one, and it must only ever pass a trusted caller's id: never an id
   from a URL, body or header, since possessing an id grants nothing.
8. **A Hub reader URL on another person's Workspace redirects.** The Workspace
   layout answers 404 for a Workspace outside the caller's navigation, so the
   owner's address bar `/w/<owner-ws>/shares/<token>` sent to a recipient was a
   404. The layout now sends exactly that path shape (a UUIDv4 token, nothing
   after it) to the caller's own `/w/<personal-ws>/shares/<token>` with the
   whole query (`?d=`, `?thread=`), from the path the middleware passes in
   `x-hub-path`. The redirect judges nothing; the page judges the share after
   it, so a reader the link does not name still ends at the dead link's 404.
   Every other foreign `/w/<id>/…` path stays a 404.
9. **The unread "shared with you" list reads only unread rows**, and a row
   judged dead there is marked read (as an unread mention is), so dead rows
   cannot fill the window and hide an older live share, and are not judged
   again on every poll. A document archived and later restored therefore
   loses its share's unread mark.

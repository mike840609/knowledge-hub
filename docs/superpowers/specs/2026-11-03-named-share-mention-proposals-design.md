# Mention proposals on named shares — design

Amends `2026-11-03-named-recipient-share-design.md` ("Discussions and mentions").
Where the two disagree, this one wins for mentions written through a NAMED link.

## Intent

A recipient reading a NAMED share wants to pull a colleague into the discussion.
Today that mention is refused (`MENTION_NOT_RECIPIENT`): only the owner can widen
the list, so the conversation stalls until the recipient asks the owner outside the Hub.

Now the mention goes through as written. Mentioning a person who is not on the list
**proposes** them to the owner. The proposed person reads nothing until the owner
approves; approval adds them as a recipient, exactly as if the owner had named them.

## Goals

- A recipient writing through a NAMED link may mention anyone signed in to the Hub.
- A mention of a non-recipient is stored with the comment and creates a **proposal**
  for that person on that link, awaiting the owner.
- The proposed person's Inbox shows, while pending: who mentioned them, the document
  title, and "someone proposed sharing a document with you". No comment text,
  no link, no way to open it.
- **The owner mentioning a non-recipient adds them** (the user's decision,
  2026-11-03): the owner decides the list, so their mention needs no approval.
- The owner decides in two places, one decision: an Inbox entry with Approve / Decline,
  and a "Pending" section in the link's Manage panel.
- **Approve:** the person becomes a recipient (same row, same "shared with you" entry,
  same everything as an owner add); their mention becomes a normal live mention.
- **Decline:** the proposed person and the proposer each get an Inbox notice that the
  owner declined. The proposed person never reads the comment.

## Non-goals

- LINK (anyone-with-the-link) shares. Their mentions already admit anyone.
- Proposals without a mention (a "suggest someone" button). The mention is the proposal.
- Expiry of proposals. A pending proposal waits until decided or the link dies.

## Anti-goals

- **The comment text reaching a non-recipient.** Before approval the proposed person
  sees only proposer name and title. A decline never reveals it either.
- **A proposal acting as access.** No read path (`/w/<ws>/shares/:token`,
  `/s/:token/open`, review queries, follows) may admit a user because a proposal
  exists. Access is the recipient row and nothing else.
- **Two sources of truth for the list.** Approval writes the existing
  `document_share_link_recipients` row through the existing add path (same audit
  event, same limit); there is no "approved proposal" read anywhere for access.

## Accepted disclosure (the user's decision, 2026-11-03)

The original spec refused these mentions partly so that a non-recipient would never
learn the share exists. This design deliberately gives that up: a proposed person
learns that the document exists, its **title**, and **who** wanted them in. They learn
nothing else. A recipient who mentions someone is choosing to tell them this much.

## Model

New table `document_share_link_proposals`:

| column | meaning |
|---|---|
| `id` UUID PK | |
| `share_link_id` | the NAMED link (FK) |
| `user_id` | the proposed person (FK users) |
| `proposed_by` | the first recipient who mentioned them while pending (FK users) |
| `comment_id` | the comment that first proposed them (FK) |
| `status` | `PENDING` / `APPROVED` / `DECLINED` |
| `created_at`, `decided_by`, `decided_at` | |
| `owner_read_at`, `proposed_read_at`, `proposer_read_at` | each party's own Inbox read state |

At most one row per `(share_link_id, user_id)`: unique key. A later mention of a
person already pending adds no row. **A decline is final for proposals** (Claude's
call, against spam): mentioning a declined person again stores the dead mention and
creates nothing for the owner; the owner can still add them directly from Manage.

The mention itself is stored in `review_mentions` as today, carrying the NAMED link.
It stays dead (judged per request: the link does not admit the user) until approval
makes the user a recipient, at which point it is live with no further write.

## Write path

In `DocumentReviewService.mentionLink`, for a **link write** (`originShareLinkId` set)
through a NAMED link **by a caller who is not the Workspace owner**:

1. Every mentioned id must exist (unchanged).
2. Split the ids into recipients (admitted) and others.
3. Others no longer fail `MENTION_NOT_RECIPIENT`. In the same transaction as the
   comment: insert the mentions for everyone, and a `PENDING` proposal for each
   other person who is not already a recipient (checked in the transaction) and has
   no row yet for this link.
4. Refused when the link is full: if recipients + pending proposals would exceed
   `MAX_NAMED_SHARE_RECIPIENTS` (50), fail with a clear message.

**Owner writes** (the Workspace owner, whether through the NAMED link's Hub reader or
from the Workspace view handing over a NAMED link with `mentionLinkId`): every mentioned
non-recipient is **added as a recipient** in the same transaction as the comment,
through the existing add path (audit `SHARE_RECIPIENT_ADDED`, `SHARED_WITH_YOU` entry,
limit of 50; over the limit the write is refused). Their mention is then live and
follows as any mention does. A pending proposal for that person becomes `APPROVED`.
`mentionLinksForOwner` therefore lists every live link of the document, NAMED ones
whatever the mentioned people, and the owner's link picker says that choosing a NAMED
link adds the people not yet on it.

`mentionOnWrite` must **not** create a follow for a non-admitted user
(`followForMention` judges the link for them; confirm it refuses, and test it).
**On approval**, the person follows, through this link, every thread where a stored
mention through this link names them (Claude's call: the same follow every other
mention gives, so they get replies). That is part of the approve transaction.

## Mention candidates

`/api/review-mentions/candidates` on a NAMED link: today it answers recipients only.
Now it answers recipients first, then other Hub users (`searchExisting`), up to
`MENTION_LIMIT`; each candidate carries `needsApproval: boolean`. The composer shows
non-recipients with a muted "needs owner approval" note. Still signed-in only.

## Inbox

New entry kinds in `listActivityForOwner` / `listUnreadForOwner` / the badge count:

- **`PROPOSAL_REQUEST`** (owner): "<proposer> proposed adding <person> to 《title》",
  with Approve / Decline. Unread until decided or opened.
- **`PROPOSAL_PENDING`** (proposed person): "<proposer> mentioned you in 《title》 —
  someone proposed sharing a document with you. Waiting for the owner."
  No href, no excerpt.
- **`PROPOSAL_DECLINED`** (proposed person, and the proposer): "The owner declined
  sharing 《title》 with <person>" / "…with you".
- **`PROPOSAL_APPROVED`** (proposer only; Claude's call): "The owner added <person>
  to 《title》". The proposed person gets the existing `SHARED_WITH_YOU` entry plus
  their now-live mention instead.

While a proposal is `PENDING` or `DECLINED`, the proposed person's dead mention for it
is **not** listed separately (one entry per proposal, not a blank row beside it).

Every entry is judged per request against the link: if the link is revoked, or the
document is archived, the entry names nothing (as a dead link's entries do today) and
the owner's Approve / Decline answers as a dead link does.

## Folder NAMED links

A proposal is on the link, so on a folder link approval opens the whole folder, not
the one document the comment is on. Every proposal entry therefore names what the
link opens: the folder name for a folder link ("《folder》 folder"), the document title
for a document link (Claude's call: the owner must see the real width of the grant).

## Lifecycle (Claude's calls)

- The proposal is independent of its comment and its proposer: hiding the comment,
  removing the thread, or removing the proposer as a recipient leaves it pending.
- Adding the person directly from Manage marks a pending proposal `APPROVED`.
- Approve at the recipient limit fails with the limit message and leaves it `PENDING`.
- Only `PENDING` proposals count toward the write-time limit.
- While a proposal is `PENDING` or `DECLINED`, the proposed person's dead mentions
  through that link are not listed separately; the proposal entry stands for them.

## Owner decision API

`POST /api/share-links/:linkId/proposals/:proposalId/approve` and `/decline`.
Trusted caller, link owner only, link live, proposal `PENDING`; anything else answers
not-found. Idempotent on an already-decided proposal in the same direction.
Approve: insert the recipient through the existing add path (audit event
`SHARE_RECIPIENT_ADDED`, recipient limit), then mark `APPROVED`. Decline: mark
`DECLINED`, audit `SHARE_PROPOSAL_DECLINED`. Adding the person directly from Manage
while a proposal is pending also marks it `APPROVED`.

## Manage panel

The link's Manage list gains a "Pending approval" section above "People who can open
this link": each row shows person (name · emp_id · org_code), "proposed by <name>",
and Approve / Decline. Same API as the Inbox.

## Invariant text to change (CLAUDE.md, named-share spec)

- "a mention through it reaches only its recipients" becomes: a mention through it
  reaches its recipients; a mention of anyone else is a proposal that grants nothing
  and tells that person only the proposer's name and the title, until the owner adds them.

## Tests the change must carry

- Integration: recipient mentions a non-recipient → comment stored, mention stored,
  one pending proposal; the proposed user cannot read `/w/<ws>/shares/:token`, review
  queries, or the thread; no follow created.
- Same person mentioned twice while pending → one proposal. After decline → new one.
- Approve → recipient row + `SHARED_WITH_YOU` + mention now live; proposer notified.
- Decline → both notified; comment text appears in neither entry.
- Revoked link → pending entries name nothing; approve answers not-found.
- Non-owner (including the proposer) cannot approve/decline.
- Link full → write refused.
- Owner write mentioning a non-recipient through a NAMED link (Hub reader, and Workspace
  view with `mentionLinkId`) → recipient added, `SHARED_WITH_YOU` entry, mention live,
  follow created, pending proposal marked `APPROVED`; over 50 → refused, nothing written.
- `tests/unit/share-link-single-exception.test.ts` still passes (no new caller-less entry).
- e2e: recipient mentions an outsider; outsider's Inbox shows the pending entry with
  title and proposer, no text; owner approves from Inbox; outsider opens the share and
  reads the comment.

## Left to the builder

- Exact Inbox copy and layout, within the design language.
- How the unique-pending constraint is expressed in MariaDB.
- Whether Approve / Decline in the Inbox is inline or opens the Manage panel, as long
  as both places work.

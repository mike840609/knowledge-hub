# Team space publishing

Status: design, approved in conversation 2026-10-30. Not yet planned.

## Intent

A team space is where developers and PMs read and discuss the team's
knowledge. Content arrives from members' own My Space: their personal notes,
PM documents, and documents that live in a git repo (for example
`docs/superpowers/` written by superpowers skills), which several developers
hold identical copies of in their checkouts.

**There is one way in: publish from My Space to the team.** The Hub never talks
to git.

The rule that shapes everything: **every team document has exactly one person
who may update it, its creator** — the member whose publish first put it in the
team. One writer means no overwrite conflicts, no merge, and exactly one person
to notify.

## Goals

- A member publishes a **My Space folder** or a **single My Space document** to
  a Team workspace.
- Published documents update automatically whenever the creator's original
  gets a new revision (from Folder Sync or a Hub save).
- Several members holding the same repo folder share **one** publication: the
  first publishes, the others join. No duplicate copies in the team.
- Every team member reads and discusses every published document. Comments
  notify that document's creator only.
- Changes happen on originals, never in the team. A suggestion is a comment;
  the creator (or, for repo documents, anyone through git) changes the source,
  and the creator's next sync carries it into the team.

## Non-goals (this version)

- Talking to git (webhooks, pulls, credentials).
- Team-owned editable documents; editing in the team.
- Approving or merging suggestions in the Hub.
- Transferring a document's creator, or "taking over" a departed member's
  documents.
- Following discussions without a share link; notifying anyone but the creator.
- Team-owned grouping folders or labels.
- A pause-publishing switch.
- Showing the `VIEWER` role in the UI.

## Anti-goals (failure even if it works)

- Two people able to overwrite the same team document.
- The same repo document appearing twice in a team because two people
  published it.
- A document visible in two Workspaces. Team documents are **copies** in a team
  source, never references to a personal document: a reference would break
  "a document belongs to one source and one workspace" and "scope is derived
  `Document → Source → Workspace`".
- Publishing something nobody chose (wikilink targets are never auto-published).
- Share links used as an internal team channel.

## Model

### Publication

A publication is a source in the Team workspace, fed from members' My Space.

- Kind: **folder** (joinable) or **document** (single contributor, not
  joinable).
- Name: chosen at publish time, defaulting to the origin folder's or
  document's name. **Unique among the team's active publications**, enforced
  by a database constraint so two concurrent publishes cannot both take a name.
  A clash asks the publisher for a name that says what the content is; no
  automatic suffixes. Archived publications free their name. Renaming later
  (publication creator or an admin) uses `renameSource` and creates no
  revision.
- Publication creator: the member who published it first.
- Backed by its own `KnowledgeSource` (a new `SourceType`;
  `src/modules/knowledge/domain/source-policy.ts`), read-only in the Hub and
  written only by the publication mechanism. `KnowledgeSource` has no owner
  field, so creators are stored in new tables, never inferred from `createdBy`.

### Contributors and document creators

- A **contributor** is a member linked to a publication from one of their My
  Space folders (or, for a document publication, the one document). The
  publication creator is the first contributor.
- Any team member with `source.manage` may **join** a folder publication from
  one of their My Space folders. Joining compares the relative paths of their
  folder with the publication's; low overlap warns that this may be the wrong
  folder (the same idea as Folder Sync's wrong-folder safeguard,
  `docs/superpowers/specs/2026-10-03-folder-sync-first-wave-design.md` §2).
- Each team document has a **document creator**: the contributor whose original
  first produced it.
- Matching: the first time a contributor's original is seen, it is matched to a
  team document by **relative path within the publication**. If no team
  document has that path, one is created and that contributor is its creator.
  The match is then remembered as *contributor's document id → team document*,
  so later renames and moves by the creator follow the document.
- **Only the document creator's originals update a team document.** Another
  contributor's version of the same path is not applied. Their sync preview and
  result say so ("maintained by Mike; your version does not update the team").

### One original, one team document per team (my call)

- Within one Team workspace an original feeds **at most one** team document.
  Publishing or joining with a folder that contains an original already
  published to that team (folder `/a` then `/a/b`; a single document already
  inside a published folder) is refused for the overlapping originals, with a
  message naming the existing publication. Enforced by a database constraint
  on (original document, team workspace) that covers **active publications
  only**: archiving a publication (unpublish or admin archive) releases its
  originals, as it releases its name, so they can be published to that team
  again.
- Publishing the same original to **different** teams is allowed. Updates fan
  out per team, and freezing is per team.

### Paths (my call)

- A team document's path is the original's Folder Sync `sourcePath` relative
  to the published folder. Only Folder Sync originals in a folder publication
  have one (the entry mapping in the sources module; revisions do not carry
  it). A document publication's single document has no path; it matches by
  document id only.
- **Hub-written originals have no path.** They never match across
  contributors: each is its contributor's own team document, and its team
  `sourcePath` is `NULL` (as the code stores "no path", `link-resolution.ts`),
  never `''`, so it reserves nothing in a unique index and relative `.md` links
  in it stay unresolved, as for Hub documents today (knowledge graph spec §6.3).
  Joining and the join suggestion therefore matter only for synced folders,
  which is the repo case they exist for.
- **A team document has exactly one current original.** Re-pointing a team
  document to a new original replaces the old mapping; the old original stops
  feeding it, even if it is later restored in My Space.
- A non-`NULL` path is **reserved to one team document in a publication**, even
  while that document is archived (database constraint). Matching, creation,
  rename and move all honor the same reservation.
  - Path held by **another creator's** team document, active or archived: the
    creator's rename or move onto it is not applied to the team; the team
    document keeps its old path; the creator's sync result says why. A
    reservation never expires, so this stays blocked until that document's
    creator moves it.
  - Path held by the creator's **own archived** team document: whether Folder
    Sync saw a move (same document id) or a delete plus add (new id), the result
    is the same: that archived team document is **reattached**: restored,
    re-pointed to the incoming original (see above), and updated. Its
    discussion threads are kept. If the incoming original already feeds another
    team document of the same creator (a move), that other team document is
    archived and its own path stays reserved to it.
  - Path held by the creator's **own active** team document (a swap or
    rotation within one sync; an original restored after being re-pointed
    away): a contributor's moves are resolved together against the final state
    of their originals, not one at a time. If a conflict remains in that final
    state, the move is not applied and the sync result says why.
  - Two contributors' new originals reach the same new path at once: the
    constraint decides; the loser is a non-creator for that path.
  - Another contributor holding a path whose team document is archived does not
    restore it; if its creator is frozen or has left, the path stays missing
    from the team. That is the accepted cost of "only the creator updates".
- The team document's `sourcePath` is stored on the sources side (the
  publication mechanism belongs in the sources module, beside the projection
  service); table shape is the builder's call.

### When the team updates

Trigger: **a new revision of a creator's matched original is inserted.**
Folder Sync and Hub saves both insert revisions, so one rule covers both.

- **Mechanism: a domain event recorded in the same transaction** (decided).
  The revision writers that already replace link edges in their transaction
  (`tests/unit/link-index-write-points.test.ts` lists them:
  `create-document.ts`, `create-revision.ts`,
  `source-knowledge-projection-service.ts`) also record an event "document D
  has revision R". The sources-side publication mechanism consumes the events
  and updates team documents. Knowledge never imports sources and needs no
  port *into* sources (it does need its own repository port to write event
  rows); the existing `source-policy` port keeps answering only what a source
  allows. Each event is written in its writer's transaction (knowledge's unit
  of work for Hub writes, the sources unit of work for
  `source-knowledge-projection-service.ts`). A team failure never fails or slows the save.
- Tree moves, renames and lifecycle changes of originals (My Space tree
  mutations and sync-applied moves and archives) record events the same way.
  A guard test of the link-index kind fails when a writer of revisions, moves
  or lifecycle forgets to record one.
- **Whose rights, judged how.** Group-derived rights can only be judged with
  the contributor's own caller (`evaluateEffectiveCapabilities` takes the
  caller's validated group ids). So one rule applies to every consumption, as
  it does to catch-up:
  - Consumed in the contributor's own request (a post-commit drain with their
    caller context): their rights are judged with groups; pass → apply, fail →
    freeze.
  - Consumed without their caller (a worker, a restore, catch-up): a direct
    membership row holding `source.manage` in an active team → apply; otherwise
    the contribution is marked **pending** (not frozen) and is reconciled on
    their next own save or sync.
- **Detectability:** an unconsumed event means the team is behind; it covers
  content, placement and lifecycle alike. Consumption is idempotent and
  reconciles the original's current state (not the event's payload), so a
  late or repeated event cannot regress a team document.
- The team document gets its own revision with the original's title, Markdown
  and metadata; the team document's path is set as above. Link edges are
  replaced as for any revision. Unchanged content (`contentHash` equal)
  creates no revision.
- Tree moves and renames of a creator's original inside the published folder
  move or rename the team document (subject to path reservations). Moves create
  no revision.
- A new original appearing in a contributor's published folder: matched or
  created as above.
- Creator's original archived, removed by sync, or (folder publications only)
  moved out of the published folder → team document archived. Restored →
  restored.
- Folder Sync's own safeguards run in the contributor's sync, before anything
  reaches the team.
- Accepted: a Hub save of a half-written note is published. A creator syncing
  from an older checkout of their own can update their own documents with older
  content; that is the same risk they have in My Space alone.

### Avoiding duplicate publications

When a member publishes a folder whose relative paths overlap strongly with an
existing publication in the target team, the publish screen suggests joining
that publication instead. This is guidance; nothing blocks a new publication,
because the Hub cannot know two folders are copies of one repo.

### Position in the team

Tree nodes belong to a source (`KnowledgeTreeNode.sourceId`,
`src/modules/knowledge/domain/tree-node.ts`), and each publication is its own
source, so each publication is **one top-level entry** in the team, listed by
name with its creator in small text. A publication cannot sit under another
publication's folder. Inside a folder publication the tree follows the
documents' paths; folders are created as paths need them and an emptied folder
disappears (builder's call on exactly how). A Hub-written document, which has
no path, is placed where it sits in its contributor's My Space tree relative to
the published folder, and reserves nothing (two such documents may share a
name). Nobody rearranges inside a publication.

```
Team space
├─ HCM KM 設計        Mike · 3 天前更新
├─ Payroll 設計       Ann · 昨天更新
└─ HCM KM 需求        Lisa · 2 週前更新
```

Each document shows its creator ("由 Mike 維護"). In a repo publication the
revision author is whoever synced, not whoever wrote the text in git; the UI
says "updated by", never "author".

### Links and search

Wikilinks resolve within the Team workspace and already rank candidates from
the **same source first**
(`docs/superpowers/specs/2026-09-29-personal-workspace-knowledge-graph-design.md`
§6.2), so a link inside a publication prefers that publication's documents.
Relative `.md` links resolve within the same source by `sourcePath`. A link
whose target is not in the team renders as **plain text**. Team search covers
published documents with no special handling.

## Roles

Team workspaces keep the four roles in code
(`src/modules/workspaces/domain/workspace-capability.ts`). The UI offers two:

| UI label | Role | Can |
|---|---|---|
| 管理員 | `ADMIN` | everything a member can, plus archive/restore/rename any publication, hide comments, manage basic membership (`membership.manage_basic`; not other admins) |
| 成員 | `EDITOR` | read, discuss, publish, join (`source.manage`) |

**"Admin" in this spec means `OWNER` or `ADMIN`, whether assigned directly or
through an SSO group**, judged by the existing capability evaluation like every
other team administration check. `OWNER` is not selectable: the team's creator. `VIEWER` is hidden; it returns
as a UI change if a read-only audience appears. Members who only read are
still 成員.

## Existing team authoring and import

Today an `EDITOR` holds workspace-wide `document.write` and `source.manage`, so
a team can hold Hub-written documents and folder imports.

- **Hidden in the UI, kept in code.** Publishing is the only way content enters
  a team. Team workspaces are behind a default-off flag, so no user loses a
  path; the code and tests stay for later team-owned documents.
- **Publication sources are locked server-side**: every source, document and
  tree mutation on one is refused except, exhaustively:
  1. the publication mechanism acting for a document's creator;
  2. archive or restore of the whole publication by an admin;
  3. unpublish (archive) or restore of the whole publication by its
     publication creator, while they hold `source.manage` in the team and have
     not left the publication;
  4. rename of the publication by its publication creator (same conditions) or
     an admin.

  `document.write` and `source.manage` alone do not override this.

## Discussion in the team

Review is personal-only today: `DocumentReviewService.scope()` rejects any
non-`PERSONAL` workspace
(`src/modules/knowledge/application/document-review-service.ts:458`), and it
knows a live share-link holder (`linkScope`) and the personal workspace owner
(`ownerScope`, matched on `personalOwnerUserId`).

Add a **team member** scope:

- Threads attach to the team document. Team discussion does not mix with share
  link discussions on the original.
- Any active member of that Team workspace may read threads and write
  comments, replies and mentions. A caller is always required; the no-caller
  exceptions guarded by `tests/unit/share-link-single-exception.test.ts` are
  unchanged.
- "Owner" means **the team document's creator** everywhere review uses
  `personalOwnerUserId`: notifications, Inbox unread counts, mark-read. Only the
  creator is notified of comments; people mentioned are notified as today.
  Commenters are not told of replies unless mentioned.
- **Creator and mention access is re-judged on every request.** A personal
  workspace's owner can never lose access, so owner paths need no membership
  check today; a team creator can. Every creator- or mention-based team path
  (Inbox entries, unread counts, mark-read, hide, unpublish, rename) re-checks
  that the caller currently holds `document.read` (or `source.manage` for
  unpublish and rename) in the team, groups included, judged as the caller.
  When the check fails, the entry stays but **names nothing** (no title, author,
  words or link), as a dead link's follow entry does today; it reads normally
  again if they regain access. Being a creator, or once mentioned, grants
  nothing on its own.
- Hiding a comment: the document creator (under the check above) and admins.
- Quotes anchor to a revision; an update makes quotes of changed text outdated
  and excluded, as today. Rate limits, quotas and the writes-enabled switch
  apply as today.
- Mention candidates: the team's **direct** members. Group-derived membership
  can only be judged for the current caller (`evaluateEffectiveCapabilities`
  uses the caller's validated group ids), so group-only members cannot be
  listed; they can still read and comment. A team mention hands over no share
  link; it points at the team document, readable only by members.

## A contributor loses the right to publish

There is no account deactivation, and group membership can only be judged for
the current caller, so "has left" is not computed at read time.

- A team update is triggered by the creator's own sync or save; their
  `source.manage` in the team is judged by the rule under "Whose rights, judged
  how" (with their caller when consumed in their request, otherwise direct row
  or pending).
- If the check fails (removed, demoted, team archived), the update is skipped and that
  contributor is marked **frozen** in the publication. Their documents stay
  readable, labelled "no longer updated". Their originals are untouched. Other
  contributors still cannot update those documents.
- A later successful update by the same contributor unfreezes a contribution
  frozen **only because of lost rights**.
- A contributor may leave a publication: their documents remain readable and
  frozen, but voluntary leave is recorded separately from a rights-based
  freeze. Ordinary saves, syncs and catch-up must not reactivate a contribution
  they left, even if they still hold `source.manage`. Resuming requires an
  explicit action by that same contributor; this does not let another member
  join a single-document publication or take over its documents. While they
  have left, their originals still count toward the one-original-per-team
  constraint (their team documents still exist).
- If the contributor leaving is the publication creator, the tree entry still
  names them (attribution), but they **lose unpublish, restore and rename**
  while they have left (decided): someone who stepped away should not archive
  joiners' work. Admins keep those rights; resuming restores the creator's.
- **Unfreezing and resuming reconcile, not copy.** Both run the same
  per-contributor reconciliation as catch-up (below): eligible originals,
  lifecycle, location and current revision. Copying the triggering revision
  alone would miss moves, archives and new originals made in the meantime.
- Team workspaces switched off (`KM_TEAM_WORKSPACES_ENABLED` not `true`,
  `src/server/composition.ts:128`) is **not** a loss of rights: while off, team
  updates are skipped without freezing anyone (events stay unconsumed, so being
  behind remains detectable). Re-enabling runs a catch-up (a repair script, like
  the link-index repair). It has no caller, so it cannot judge group-derived
  rights:
  - Contributors with a **direct** membership row holding `source.manage` in an
    active team are reconciled.
  - Contributors without one (group-only, removed, demoted) and every
    contributor of an archived team are marked **pending catch-up**, not frozen;
    their next own save or sync, which runs as them, checks their rights and
    then reconciles (or freezes if the check fails).
  - Reconciliation covers the current set of originals eligible for the
    publication, their lifecycle, their location relative to the publication
    root, and their current revisions. Newly eligible originals are matched or
    created; originals archived or moved out while updates were off archive
    their team copies; moves within the folder update placement and paths under
    the same reservation rules.
  - Catch-up preserves voluntary leave, rights-based freezes, admin-archived
    **and unpublished** publications, and never restores any of them
    implicitly.

## Archive and unpublish

- Admins archive or restore a **whole publication** (`archiveSource` exists).
- Unpublish: the publication creator or an admin; it archives the **whole**
  publication, including joiners' documents (decided).
- Both are **sticky**: contributors' updates and catch-up do not restore an
  archived publication; only a restore by an admin or the publication creator
  does. Restoring reconciles every non-frozen, non-left contributor under the
  caller-less rule (direct row → reconcile, otherwise pending), since the
  restorer cannot judge other contributors' group rights.
- Archiving releases the publication's name and its originals (see "One
  original, one team document per team"). Restoring re-claims both and fails
  with a clear message if another active publication has taken either since.
- Single documents follow their creator's originals (archived, restored, and,
  in folder publications, moved out).
- Lifecycle stays `ACTIVE` / `ARCHIVED`; nothing is hard-deleted.

## Constraints

- Behind `KM_TEAM_WORKSPACES_ENABLED` (default off), like Team workspaces.
- All `CLAUDE.md` invariants hold: scope derived never stored twice, IDs are not
  authorization, `ACTIVE`/`ARCHIVED` only, every revision writer replaces link
  edges, the reader never passes HTML.
- Publishing and joining re-check, in the application service, that the caller
  owns the origin (it is in their personal workspace) and holds `source.manage`
  in the target team.
- Knowledge reaches sources only through its `source-policy` port; publication
  updates travel as domain events recorded in knowledge's own transactions, not
  as calls into sources.

## Left to the builder

- Table and column names; the new `SourceType` name.
- How events are stored and consumed (table, worker or in-process drain),
  within the idempotency and detectability rules above.
- Adding event recording to the revision writers changes nothing in
  `link-index-write-points.test.ts`'s exact writer list; a new writer would
  have to update both guard tests.
- Publish / join / leave UI placement in My Space and the team.
- The path-overlap threshold for the join warning and the join suggestion.
- How empty folders inside a publication are removed.
- Whether an unpublished publication's rows are kept for history.

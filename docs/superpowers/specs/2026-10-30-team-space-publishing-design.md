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
  uses `renameSource` and creates no revision.
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
  on (original document, team workspace).
- Publishing the same original to **different** teams is allowed. Updates fan
  out per team, and freezing is per team.

### Paths (my call)

- A team document's path is the original's Folder Sync `sourcePath` relative
  to the published folder. Only Folder Sync originals have one (the entry
  mapping in the sources module; revisions do not carry it).
- **Hub-written originals have no path.** They never match across
  contributors: each is its contributor's own team document, and its team
  `sourcePath` is empty, so relative `.md` links in it stay unresolved, as for
  Hub documents today (knowledge graph spec §6.3). Joining and the join
  suggestion therefore matter only for synced folders, which is the repo case
  they exist for.
- Paths are **unique among active team documents in a publication** (database
  constraint).
  - A creator renames or moves an original onto a path held by another
    creator's active document: the move is not applied to the team; the team
    document keeps its old path; the creator's sync result says why.
  - Two contributors' new originals reach the same new path at once: the
    constraint decides; the loser is a non-creator for that path.
  - A path whose team document was archived still belongs to that document and
    its creator. The creator re-adding a file at that path (even with a new
    document id) restores and updates it. Another contributor holding the path
    does not; if the creator is frozen, the path stays missing from the team.
    That is the accepted cost of "only the creator updates".
- Where the team document's `sourcePath` is stored, given knowledge may not
  import sources, is the builder's call (the publication mechanism belongs in
  the sources module, beside the projection service).

### When the team updates

Trigger: **a new revision of a creator's matched original is inserted.**
Folder Sync and Hub saves both insert revisions, so one rule covers both.

- Hook into the same writers that replace link edges in the same transaction;
  `tests/unit/link-index-write-points.test.ts` lists them
  (`create-document.ts`, `create-revision.ts`,
  `source-knowledge-projection-service.ts`). Add a guard test of the same kind
  for publication updates.
- Same transaction or a follow-up job: builder's call, provided a team document
  can never be left permanently behind its original without that being
  detectable.
- The team document gets its own revision with the original's title, Markdown,
  metadata and `sourcePath` (relative to the publication root, so relative
  `.md` links resolve inside the publication). Link edges are replaced as for
  any revision. Unchanged content (`contentHash` equal) creates no revision.
- Tree moves and renames of a creator's original inside the published folder
  move or rename the team document. Moves create no revision, so this needs a
  second set of hooks (My Space tree mutations and sync-applied moves), with its
  own guard test.
- A new original appearing in a contributor's published folder: matched or
  created as above.
- Creator's original archived, removed by sync, or moved out of the published
  folder → team document archived. Restored → restored.
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
disappears (builder's call on exactly how). Nobody rearranges inside a
publication.

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
| 管理員 | `ADMIN` | everything a member can, plus archive/restore any publication, manage members |
| 成員 | `EDITOR` | read, discuss, publish, join (`source.manage`) |

`OWNER` is not selectable: the team's creator. `VIEWER` is hidden; it returns
as a UI change if a read-only audience appears. Members who only read are
still 成員.

## Existing team authoring and import

Today an `EDITOR` holds workspace-wide `document.write` and `source.manage`, so
a team can hold Hub-written documents and folder imports.

- **Hidden in the UI, kept in code.** Publishing is the only way content enters
  a team. Team workspaces are behind a default-off flag, so no user loses a
  path; the code and tests stay for later team-owned documents.
- **Publication sources are locked server-side**: every source, document and
  tree mutation on one is refused unless it comes from the publication
  mechanism acting for the document's creator, or is an admin archive/restore
  of the whole publication. `document.write` and `source.manage` do not
  override this.

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
- Hiding a comment: the document creator and team admins.
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

- A team update runs as its creator (it is triggered by the creator's own sync
  or save), so the creator's `source.manage` in the team is checked then,
  groups included.
- If it fails (removed, demoted, team archived), the update is skipped and that
  contributor is marked **frozen** in the publication. Their documents stay
  readable, labelled "no longer updated". Their originals are untouched. Other
  contributors still cannot update those documents.
- A later successful update by the same contributor unfreezes them and brings
  their documents current.
- A contributor may leave a publication: their documents freeze the same way.
- Team workspaces switched off (`KM_TEAM_WORKSPACES_ENABLED` not `true`,
  `src/server/composition.ts:128`) is **not** a loss of rights (my call): while
  off, team updates are skipped without freezing anyone. Because team documents
  may then be behind their originals, re-enabling runs a catch-up (a repair
  script, like the link-index repair) that brings every non-frozen
  contributor's documents current. Being behind is detectable by comparing the
  original's current revision with the one the team document was made from.

## Archive and unpublish

- Admins archive or restore a **whole publication** (`archiveSource` exists).
  An admin archive is sticky: contributors' updates do not restore it; only an
  admin restore does. Updates resume after restore.
- Unpublish: the publication creator or an admin; it archives the publication.
- Single documents follow their creator's originals (archived, restored, moved
  out).
- Lifecycle stays `ACTIVE` / `ARCHIVED`; nothing is hard-deleted.

## Constraints

- Behind `KM_TEAM_WORKSPACES_ENABLED` (default off), like Team workspaces.
- All `CLAUDE.md` invariants hold: scope derived never stored twice, IDs are not
  authorization, `ACTIVE`/`ARCHIVED` only, every revision writer replaces link
  edges, the reader never passes HTML.
- Publishing and joining re-check, in the application service, that the caller
  owns the origin (it is in their personal workspace) and holds `source.manage`
  in the target team.
- Knowledge reaches sources only through its `source-policy` port.

## Left to the builder

- Table and column names; the new `SourceType` name.
- Synchronous vs queued team updates (subject to the detectability rule).
- Publish / join / leave UI placement in My Space and the team.
- The path-overlap threshold for the join warning and the join suggestion.
- How empty folders inside a publication are removed.
- Whether an unpublished publication's rows are kept for history.

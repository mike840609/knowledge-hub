# Workspace writes take a shared lock

Status: **implemented** (2026-10-07). Amends the Phase 3 canonical lock protocol
(`2026-09-14-phase-3-identity-workspace-governance-design.md` §14.2), which now points here.

## Problem

§14.2 makes every Workspace-scoped mutation hold the parent Workspace row `FOR UPDATE`.
Content writes (`create-revision`, `create-document`, tree moves), every import step
(create, upload, finalize, Apply) and governance all take that one exclusive lock, so
**writes in one Workspace queue behind each other**, even in different Sources.

A folder Apply holds it for its whole transaction. Measured on an isolated database
(real create → upload → finalize → Apply, ~5.5 KB notes):

| Notes | Finalize (holds it while parsing) | Apply (holds it throughout) |
|---|---|---|
| 2,000 | 3.9 s | 17.6 s |
| 6,000 | 11.1 s | 54.8 s |
| 20,000 (extrapolated) | ~37 s | ~180 s |

MariaDB's lock wait is 50 s (`innodb_lock_wait_timeout`, not overridden). A note saved
in the same Workspace during the 6,000-note Apply waited 50 s and failed. #135 makes
that failure read correctly (`WORKSPACE_BUSY`, 503); this design removes the wait.

## What the exclusive lock is for

§14.2's guarantee: **no mutation commits after its Workspace is archived, or after the
writer's capability is revoked.** Archive, restore, rename and membership/group changes
lock the Workspace `FOR UPDATE`; a writer revalidates lifecycle and capability only after
it holds the same row. So a governance change waits for writes already in progress, and
every later write sees its result.

That needs **writers to exclude governance**. It does not need **writers to exclude each
other**: ordering within one Source is already protected by the Source row
`FOR UPDATE`, which every Source-scoped write takes first and this design keeps.

## Design

`lockWorkspaceForMutation` takes the Workspace row `LOCK IN SHARE MODE` for its two
writer operations, `content-write` and `source-import`, and is otherwise unchanged
(lifecycle and capability are still revalidated on the locked row, in the same order).
Governance keeps `FOR UPDATE`:

| Path | Workspace lock | Source lock |
|---|---|---|
| Content writes, share links | shared | `FOR UPDATE`, unchanged |
| Import create / upload / finalize / Apply | shared | `FOR UPDATE`, unchanged |
| Archive, restore, rename, member/group changes | `FOR UPDATE`, unchanged | none |
| `ensure-default-hub-source` (see below) | `FOR UPDATE`, unchanged | none |

MariaDB 10.11 rejects MySQL's `FOR SHARE` as a parse error; the statement is
`SELECT … FROM workspaces WHERE id = ? LOCK IN SHARE MODE`.

Verified on MariaDB 10.11.19 with three connections on one Workspace row: a second
shared lock is granted at once while the first is held; `FOR UPDATE` waits while any
shared lock is held (it timed out under a 2-second wait) and is granted at once after
they end.

### Why §14.2's guarantee still holds

- A shared and an exclusive lock on one row conflict. Archive/governance waits for every
  writer holding the shared lock, exactly as it waited for the exclusive one.
- A writer acquires the shared lock before it revalidates, so a writer that starts after
  governance commits reads the new lifecycle and capabilities and is refused.
- Lock order is unchanged (Snapshot → Source → Workspace → deeper); only the mode of the
  Workspace step changes.

### Deadlocks

Two shared holders deadlock only if one later asks for `FOR UPDATE` on the same row. No
writer does: the only statements that write the `workspaces` row are rename and
lifecycle (`repositories/workspaces.ts`), both reached from governance services that
take `FOR UPDATE` directly. Implementation must keep a test that fails if a writer path
locks the Workspace row twice.

### The one check-then-insert that stays exclusive

`ensure-default-hub-source` looks for an active "Hub" Source and inserts one when there
is none. No unique key backs that check (`knowledge_sources` has none on workspace plus
type or name), so under a shared lock two first requests could each insert one. It keeps
`FOR UPDATE`; it runs once per Workspace, so the cost is nil. (A unique key would also
work but needs a migration over existing data; not proposed here.)

## What this does not change

- **Governance still waits behind a long Apply.** Archiving or changing members during a
  20,000-note Apply waits up to the lock timeout and then fails as `WORKSPACE_BUSY`. That
  is rare and now reads correctly. Shortening Apply (about 9 ms per note today, one
  transaction) is separate work.
- **Writes to the same Source still queue,** by design. For a folder Source that is
  correct; its documents are read-only outside sync.
- **Finalize still parses under the lock.** With a shared lock that no longer blocks other
  writers; moving parsing out of the transaction is optional follow-up.

## Verification required

Behavioural, against real MariaDB (concurrency tests already cover §14.2 in Phase 3):

1. During a long-held import lock (simulated: a connection holding the Workspace row
   shared, as Apply will), a note saved in another Source of that Workspace commits
   promptly.
2. Archive started while a writer holds the shared lock waits, commits after it, and no
   write started after archive commits (existing post-archive tests keep passing).
3. Membership revoked while a writer is in flight: the in-flight write may commit; a
   write that starts after revocation is refused.
4. Two concurrent `ensure-default-hub-source` calls create exactly one Hub Source.
5. Two concurrent writes to the same Source still serialize (tree positions stay valid).
6. No writer path locks the Workspace row twice.
7. The measurement above, re-run: a save during a 6,000-note Apply succeeds well under
   the lock wait.

## Verification results

- `tests/integration/workspace-shared-write-lock.test.ts`: a note in another Source commits
  while an import holds its Source and the Workspace (item 1); a write to the same Source
  still waits (item 5); archive cannot proceed while a write is in flight and writes are
  refused once archived (item 2); two racing `ensure-default-hub-source` calls create one
  Hub Source, made deterministic by pausing each after its existence check (item 4).
- The existing Phase 3 suites cover items 2 and 3 for every writer path (post-archive
  commits, membership and group-grant revocation re-read after waiting); the revocation
  cases now observe the writer at `lockSharedById`.
- `tests/unit/workspace-lock-modes.test.ts` (item 6): the exclusive `lockById` appears only
  in governance services and the guard's exclusive branch, and `{ exclusive: true }` only in
  `ensure-default-hub-source`.
- Mutation-checked: making writers exclusive again fails item 1; making
  `ensure-default-hub-source` shared fails item 4 (and the existing Phase 5 test).
- Item 7, re-measured: during a 45-second Apply of 6,000 notes, a note saved in another
  Source committed in 0.02 s (before: waited 50 s and failed).

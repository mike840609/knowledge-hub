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
| `ensure-default-hub-source` (see below) | shared to look up; `FOR UPDATE` only to create | none |

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
- **This rests on READ COMMITTED.** Every transaction sets it (`transaction.ts`), so each
  statement after the lock reads what governance committed while the writer waited. Under
  REPEATABLE READ a plain read earlier in the transaction (several writers do one, e.g. a
  tree lookup) would pin the writer's snapshot, and it would read the pre-revocation
  membership even after waiting — with either lock mode (reproduced in review). A test does
  a plain membership read before the lock and requires the revocation to be seen.

### Deadlocks

Two shared holders deadlock only if one later asks for `FOR UPDATE` on the same row. No
writer does: the only statements that write the `workspaces` row are rename and
lifecycle (`repositories/workspaces.ts`), both reached from governance services that
take `FOR UPDATE` directly. The hazard is a shared lock followed by `FOR UPDATE` on the
same row in one transaction; `ensure-default-hub-source`'s two steps are separate
transactions. A test fails if `FOR UPDATE` on the Workspace appears outside governance and
the guard's exclusive branch, or `{ exclusive: true }` outside `ensure-default-hub-source`.

### The one check-then-insert that stays exclusive

`ensure-default-hub-source` looks for an active "Hub" Source and inserts one when there
is none. No unique key backs that check (`knowledge_sources` has none on workspace plus
type or name), so under a shared lock two first requests could each insert one.

It runs on **every** "New document", and on "New folder" without a Source (corrected after
review: an earlier draft said "once per Workspace"). Taking `FOR UPDATE` each time would
fail behind a long Apply and, while queued, hold back every other writer (below). So it
looks the Source up under the shared lock like any writer and returns it when present; only
when it is missing does a second transaction take `FOR UPDATE`, re-check and insert. (A
unique key would also work but needs a migration over existing data; not proposed here.)

## What this does not change

- **Governance still waits behind a long Apply.** Archiving or changing members during a
  20,000-note Apply fails as `WORKSPACE_BUSY` (after 5 s, below) and can be retried once
  the import ends. Shortening Apply is separate work; link extraction, about half of it,
  now runs before the transaction.
- **While governance waits, new writers wait behind it.** MariaDB queues a pending
  `FOR UPDATE` ahead of later `LOCK IN SHARE MODE` requests (reproduced in review), so an
  archive or member change issued during a long Apply stalls new writes in that Workspace
  until it is granted or gives up. **Amended 2026-10-07:** the exclusive lock now waits at
  most 5 s (`SELECT … FOR UPDATE WAIT 5`, one statement, no session state left on a pooled
  connection), then fails as `WORKSPACE_BUSY`, so queued writers resume within seconds
  instead of 50. Covers every `lockById` caller: governance and the default Hub create step.
  `tests/integration/workspace-shared-write-lock.test.ts` holds an import open, starts an
  archive and then a save, and requires the archive to fail as `WORKSPACE_BUSY` and the save
  to commit (fails, by timeout, without the `WAIT`).
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
- After review: `ensure-default-hub-source` returning an existing Hub Source while an import
  holds the Workspace (fast path); the race test now pairs every existence check, so both
  the shared look-up and the exclusive create are raced; a plain membership read before
  the lock still sees a revocation committed while the writer waited (READ COMMITTED);
  blocked calls are asserted to fail by their lock wait, not by any error.
- Item 7, re-measured: during a 45-second Apply of 6,000 notes, a note saved in another
  Source committed in 0.02 s (before: waited 50 s and failed). After the fast path, "New
  document" (default Hub look-up plus create) during a 41-second Apply of 6,000 notes also
  committed in 0.02 s.

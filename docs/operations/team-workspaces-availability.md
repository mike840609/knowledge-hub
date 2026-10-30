# Team workspaces: announced, not yet available

*September 30, 2026. Personal-first rollout; this document updates the earlier approach that restricted only the workspace switcher.*

## Current state

`KM_TEAM_WORKSPACES_ENABLED` is disabled by default. The Teams section of the workspace switcher displays a disabled **Team workspaces · Coming soon** entry. It lists no Team names and offers neither the archive list nor a creation entry point. My Space remains available.

When the server establishes a trusted caller, it also restricts that caller to their own My Space. Opening a Team URL directly or using an existing Team ID through search, APIs, export, or governance services therefore does not grant access to Team content. Existing Team documents, members, roles, and archive state remain in the database and become usable again after Team access is re-enabled. Disabling the switcher alone cannot enforce this restriction; service authorization must check it too.

## Re-enabling access

Set `KM_TEAM_WORKSPACES_ENABLED=true` in the server environment and restart. Only the exact value `true` enables access. Unset, `false`, `1`, `yes`, `TRUE`, and all other values keep it disabled. No rebuild is required, and existing data and membership are unchanged.

Run the rollout in this order; steps 5 and 6 are the part that is easy to forget:

1. Take a database backup, then deploy the build that contains publications. The migrations are additive.
2. Set `KM_TEAM_WORKSPACES_ENABLED=true` and restart.
3. Run the catch-up once, from the same database and environment (next section).
4. Read its summary line. `failed=<n>` exits 1: inspect the failure, fix it, and rerun; the command is idempotent.
5. Every contributor reported `pending` (group-only members, removed or demoted members, contributors of an archived team) must now save or sync once from their own My Space, so the request is judged as them. The result depends on their current rights: a contributor who still holds `source.manage` is reconciled and their copies update; a removed or demoted contributor fails that check and becomes rights-frozen (「不再更新」), so the copy stays readable but does not reconcile. Until that request, the copies keep the 「等待同步」 label.
6. Confirm the expected end state. For a group-only contributor who still holds `source.manage`, the team tree no longer shows 「等待同步」 and `GET /api/publications/:id/status` normally reports `pending: false`; it stays true only while the saved report still names work such as an original already published elsewhere or a reserved path. For a removed or demoted contributor, the expected state is the rights-frozen label instead; `pending: false` is not a success criterion for them, and a saved report may keep pending work.

`make db-catch-up-publications` and `GET /api/publications/:id/status` are the two operators' read points; neither writes anything while the flag is off.

## Publication catch-up after reopening

While Team workspaces were off, personal saves still recorded publication events, but nothing consumed them. Turning the flag on is not enough by itself: run the catch-up once after the restart.

```bash
make db-catch-up-publications
# or: npm run db:catch-up-publications
```

- With the flag off, the script prints `skipped` and writes nothing.
- With the flag on, it first drains pending events, then scans **every** publication contribution (not only ones with an event), because moves, archives and source lifecycle changes can otherwise be missed.
- Direct members with `source.manage` are reconciled. Contributors whose rights can only be judged by their own request — group-only members, removed or demoted members — are marked **pending catch-up**, not frozen by the caller-less run. They must save or sync once after the flag is back on; that request judges their own groups. It reconciles only a contributor who still holds `source.manage`; a removed or demoted contributor is frozen at that point and the copy stays readable under 「不再更新」.
- Voluntary leave, rights-based freezes, and unpublished or admin-archived publications are preserved and never revived by catch-up.
- The output is `applied=<n> pending=<n> skipped=<n> failed=<n>`. It exits 1 if any contribution failed and 0 otherwise, and it is safe to rerun.

## Contributor states after a catch-up

A contributor's state explains what an operator should expect and what clears it:

| State | In the team | Cleared by |
| --- | --- | --- |
| Active | Documents update from the contributor's originals. | — |
| Pending catch-up (「等待同步」) | The copy stays readable but is behind. Catch-up could not judge this person's rights without their own request. | That contributor's next save or sync. With `source.manage` it reconciles current originals, placement and lifecycle (not just one revision); without the right the state becomes rights-frozen instead. |
| Rights-frozen (「不再更新」) | Documents stay readable and labelled; nobody else may update them. | The same contributor's later successful save or sync. |
| Left (「不再更新」) | Documents stay readable and frozen; the contribution is recorded as voluntary. | Only that contributor's explicit 「繼續更新」; ordinary saves and catch-up never revive it. |

`pending` is not a freeze and a freeze is not a leave. Catch-up preserves all three, plus admin-archived and unpublished publications, and never restores any of them implicitly.

## Known limits

- A Folder Sync source's root has no tree node. The import places its documents directly under the source, so My Space offers 「發佈到團隊」 for a folder inside a synced source, not for the source root itself. Publishing the whole synced source is a design follow-up; the service still accepts any owned folder node it is given.

## Unpublish, restore and rename

The publication creator or a team admin can unpublish, restore or rename. Admin means the caller's effective `membership.manage_basic` (OWNER/ADMIN, including group-derived); the creator must still hold `source.manage` and must not have left.

- **Unpublish** archives the whole publication source, so joiners' documents become invisible too. It frees the active name and every original claim but keeps documents, discussion threads, path reservations and bindings. A contributor's later save or catch-up never restores it.
- **Restore** re-claims the name and every original. If another active publication has taken the name or any original since, the whole restore rolls back and fails with `PUBLICATION_NAME_TAKEN` or `PUBLICATION_ORIGINAL_TAKEN`; the publication stays archived. On success, direct contributors are reconciled, group-only/removed contributors become pending until their own save or sync, and rights freezes are not cleared.
- **Rename** changes only the publication's canonical name (no new revision). A duplicate active name fails with `PUBLICATION_NAME_TAKEN` and the message `已有同名發佈，請取一個能說明內容的名字`.

Operationally:

- The commands are on the publication entry's menu in the Team tree. 「取消發佈／封存」 asks for confirmation first, because it archives joiners' documents as well as the creator's.
- After unpublish, a contributor saving or syncing their original is applied to their My Space as usual but **never restores the publication**. Bringing it back is always an explicit restore by an admin or the publication creator.
- A restore is all-or-nothing. If the active name or any one original has been claimed since, the transaction rolls back and the publication stays archived; nothing is half-restored. Free the conflict first (archive or rename the publication holding it) and restore again.
- Restore reconciles only contributors whose rights can be judged without their caller. A group-only or removed contributor's copies stay 「等待同步」 until that person's own save or sync; a rights freeze or a voluntary leave is not cleared by restore.

## Verification

- `tests/unit/team-workspaces-flag.test.ts` checks flag parsing; `tests/unit/personal-rollout.test.ts` checks the permissions of personal-only callers.
- `tests/integration/personal-workspace-rollout.test.ts` checks existing Team navigation, direct reads and writes, export, and data availability after re-enabling access.
- `tests/e2e/team-workspaces-coming-soon.spec.ts` checks entry points in both enabled and disabled states, and rejection of direct links while disabled.
- `tests/e2e/zz-team-publishing.spec.ts` (`@smoke-team`) walks publish → read and comment → creator save → join without overwrite → reattach → removal → unpublish with fixed trusted personas. The evidence and the exact gate commands are in the [2026-10-31 verification record](../superpowers/verification/2026-10-31-team-space-publishing.md).

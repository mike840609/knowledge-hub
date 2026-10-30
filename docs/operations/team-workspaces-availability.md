# Team workspaces: announced, not yet available

*September 30, 2026. Personal-first rollout; this document updates the earlier approach that restricted only the workspace switcher.*

## Current state

`KM_TEAM_WORKSPACES_ENABLED` is disabled by default. The Teams section of the workspace switcher displays a disabled **Team workspaces · Coming soon** entry. It lists no Team names and offers neither the archive list nor a creation entry point. My Space remains available.

When the server establishes a trusted caller, it also restricts that caller to their own My Space. Opening a Team URL directly or using an existing Team ID through search, APIs, export, or governance services therefore does not grant access to Team content. Existing Team documents, members, roles, and archive state remain in the database and become usable again after Team access is re-enabled. Disabling the switcher alone cannot enforce this restriction; service authorization must check it too.

## Re-enabling access

Set `KM_TEAM_WORKSPACES_ENABLED=true` in the server environment and restart. Only the exact value `true` enables access. Unset, `false`, `1`, `yes`, `TRUE`, and all other values keep it disabled. No rebuild is required, and existing data and membership are unchanged.

## Publication catch-up after reopening

While Team workspaces were off, personal saves still recorded publication events, but nothing consumed them. Turning the flag on is not enough by itself: run the catch-up once after the restart.

```bash
make db-catch-up-publications
# or: npm run db:catch-up-publications
```

- With the flag off, the script prints `skipped` and writes nothing.
- With the flag on, it first drains pending events, then scans **every** publication contribution (not only ones with an event), because moves, archives and source lifecycle changes can otherwise be missed.
- Direct members with `source.manage` are reconciled. Contributors whose rights can only be judged by their own request — group-only members, removed or demoted members — are marked **pending catch-up**, never frozen. They must save or sync once after the flag is back on; that request judges their own groups and reconciles their documents.
- Voluntary leave, rights-based freezes, and unpublished or admin-archived publications are preserved and never revived by catch-up.
- The output is `applied=<n> pending=<n> skipped=<n> failed=<n>`. It exits 1 if any contribution failed and 0 otherwise, and it is safe to rerun.

## Unpublish, restore and rename

The publication creator or a team admin can unpublish, restore or rename. Admin means the caller's effective `membership.manage_basic` (OWNER/ADMIN, including group-derived); the creator must still hold `source.manage` and must not have left.

- **Unpublish** archives the whole publication source, so joiners' documents become invisible too. It frees the active name and every original claim but keeps documents, discussion threads, path reservations and bindings. A contributor's later save or catch-up never restores it.
- **Restore** re-claims the name and every original. If another active publication has taken the name or any original since, the whole restore rolls back and fails with `PUBLICATION_NAME_TAKEN` or `PUBLICATION_ORIGINAL_TAKEN`; the publication stays archived. On success, direct contributors are reconciled, group-only/removed contributors become pending until their own save or sync, and rights freezes are not cleared.
- **Rename** changes only the publication's canonical name (no new revision). A duplicate active name fails with `PUBLICATION_NAME_TAKEN` and the message `已有同名發佈，請取一個能說明內容的名字`.

## Verification

- `tests/unit/team-workspaces-flag.test.ts` checks flag parsing; `tests/unit/personal-rollout.test.ts` checks the permissions of personal-only callers.
- `tests/integration/personal-workspace-rollout.test.ts` checks existing Team navigation, direct reads and writes, export, and data availability after re-enabling access.
- `tests/e2e/team-workspaces-coming-soon.spec.ts` checks entry points in both enabled and disabled states, and rejection of direct links while disabled.

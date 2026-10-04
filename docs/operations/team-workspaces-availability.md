# Team workspaces: announced, not yet available

**English** | [繁體中文](team-workspaces-availability.zh-TW.md)

*September 30, 2026. Personal-first rollout; this document updates the earlier approach that restricted only the workspace switcher.*

## Current state

`KM_TEAM_WORKSPACES_ENABLED` is disabled by default. The Teams section of the workspace switcher displays a disabled **Team workspaces · Coming soon** entry. It lists no Team names and offers neither the archive list nor a creation entry point. My Space remains available.

When the server establishes a trusted caller, it also restricts that caller to their own My Space. Opening a Team URL directly or using an existing Team ID through search, APIs, export, or governance services therefore does not grant access to Team content. Existing Team documents, members, roles, and archive state remain in the database and become usable again after Team access is re-enabled. Disabling the switcher alone cannot enforce this restriction; service authorization must check it too.

## Re-enabling access

Set `KM_TEAM_WORKSPACES_ENABLED=true` in the server environment and restart. Only the exact value `true` enables access. Unset, `false`, `1`, `yes`, `TRUE`, and all other values keep it disabled. No rebuild is required, and existing data and membership are unchanged.

## Verification

- `tests/unit/team-workspaces-flag.test.ts` checks flag parsing; `tests/unit/personal-rollout.test.ts` checks the permissions of personal-only callers.
- `tests/integration/personal-workspace-rollout.test.ts` checks existing Team navigation, direct reads and writes, export, and data availability after re-enabling access.
- `tests/e2e/team-workspaces-coming-soon.spec.ts` checks entry points in both enabled and disabled states, and rejection of direct links while disabled.

# Users.account for Company SSO

## Intent

Company SSO will supply a human-readable English account name in addition to the
employee number. Store it on `users` so the Hub can later use it for mention
autocomplete. `emp_id` remains the employee number; `account` is a trusted
profile attribute, never an identity-link key.

## Goals

- Add a nullable `users.account VARCHAR(128)` column.
- Source it from the trusted Company SSO session reader.
- Persist it when a company user is first created and refresh it on later logins.
- Support case-insensitive prefix autocomplete through the column's index.
- Keep `UserIdentity` and the existing `(provider, subject)` identity-link rules
  unchanged.

## Non-goals

- No mention/autocomplete UI or API in this change.
- No change to identity-link truth or to the `emp_id` fail-closed rules.
- No matching or claiming of existing users by `account`.
- No pre-login backfill of existing users; their account is filled on their next
  SSO login. A directory backfill can be a follow-up.
- No account values for local or Google identities; those remain `NULL`.

## Anti-goals

- Using `account` as a link key or as a fallback for `emp_id`.
- Making `account` `NOT NULL` or giving it a default, which would break existing
  rows and non-company providers.
- Adding FULLTEXT or a redundant index when a B-tree index already serves prefix
  search.

## Constraints

- The migration is additive and must apply to a populated database. Existing
  rows have no account, and multiple `NULL`s must remain allowed.
- `CompanySsoSession.account` becomes a required session field. Deployer readers
  must return it; a missing or empty value fails closed with
  `AuthUnavailableError`.
- `ExternalCompanyIdentity` is shared with local and Google providers, so its
  `account` is `string | null`.
- Autocomplete is prefix-only (`account LIKE 'prefix%'`). Substring search is out
  of scope and would not use the index.
- The column uses `utf8mb4_unicode_ci` so prefix matching and uniqueness are
  case-insensitive. If the company treats accounts as case-sensitive, use
  `utf8mb4_bin` instead before applying the migration.

## Approaches

- **A (chosen): company-SSO write path only.** `UserIdentity` stays
  `{id, emp_id, name, org_code}`. `account` is written by the identity resolver
  and repository, and read later by a dedicated query. Smallest blast radius and
  no change to identity-link rules. Cost: account is not on `CallerContext` or
  the UI until a later change.
- **B: add `account` to `UserIdentity`.** Makes account part of the canonical
  profile everywhere, but touches ~156 `emp_id` literals and needs
  null-preservation rules in `upsertIdentity`. Rejected for now because the
  requirement is storage plus future autocomplete, not a profile-wide field.
- **C: separate table.** Rejected: one value, the user explicitly wants a
  `users` column, and joins add cost without benefit.

## Design

### Schema (migration 027)

```sql
ALTER TABLE users
  ADD COLUMN account VARCHAR(128)
    CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL AFTER emp_id,
  ADD COLUMN name_en VARCHAR(512)
    CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL AFTER name,
  ADD CONSTRAINT uq_users_account UNIQUE (account),
  ADD CONSTRAINT ck_users_account_nonempty
    CHECK (account IS NULL OR CHAR_LENGTH(account) > 0),
  ADD CONSTRAINT ck_users_name_en_nonempty
    CHECK (name_en IS NULL OR CHAR_LENGTH(name_en) > 0);
```

- `NULL` covers existing rows and local/Google users.
- `UNIQUE(account)` creates the B-tree index used by `account LIKE 'prefix%'`.
  MariaDB permits multiple `NULL`s in a unique index.
- No separate index.
- `name_en` is a nullable English display name with no write path in this
  change. It matches `name`'s length and binary collation, and has no index.
- If company accounts can be reassigned to a new employee while the old Hub user
  row still exists, the unique constraint fails closed. The operator must clear
  the old row's account first. If reuse is expected and that is unacceptable,
  change this to a non-unique `KEY idx_users_account (account)` before applying.
- No character-class `CHECK`; `account` is trusted provider data and may include
  digits or punctuation.

### Identity contract

- `CompanySsoSession` gains `account: string`.
- `CompanySsoIdentityProvider` validates it with `assertSessionField` and copies
  it into `externalIdentity.account`.
- `ExternalCompanyIdentity` gains `account: string | null`; local and Google
  provide `null`.
- `HubIdentityResolver.assertTrustedExternalIdentity` requires a non-empty
  `account` only when it is not `null`.
- `UserIdentity` is unchanged.

### Persistence

- `UserRepository.insert(identity, account?: string | null)` writes
  `users.account` for new users.
- New `UserRepository.updateAccount(id, account)` refreshes an existing user's
  account.
- `MariaDbUserRepository` implements both. `upsertIdentity` and `updateProfile`
  do not touch `account`, so a local or Google upsert cannot clear a company
  account.
- Resolver behavior:
  - Existing `(provider, subject)` link: sync name/org_code as today, then call
    `updateAccount` when `external.account` is non-null.
  - No link but `emp_id` exists: unchanged fail-closed
    (`IDENTITY_LINK_REQUIRED` / `IDENTITY_LINK_CONFLICT`).
  - No link and no `emp_id`: insert the Hub user with `external.account`.

### Future autocomplete

The future read path can use:

```sql
SELECT id, account, name, emp_id
FROM users
WHERE account LIKE CONCAT(?, '%')
ORDER BY account ASC
LIMIT ?;
```

`uq_users_account` serves this query. If the UI also searches `name`, that needs
its own index or query; it is not part of this change.

### Rollout

1. Apply migration 027.
2. Deploy the code together with the updated `CompanySsoSessionReader` that
   returns `account`. The field is required, so the reader and Hub must move
   together.
3. Existing users fill `account` on their next SSO login. If accounts must be
   present before first login for autocomplete, extend the Phase 3 identity-link
   bootstrap mapping with `account` as a follow-up.

### Tests

- Migration/schema: column exists, is nullable, unique, and has the non-empty
  check; fresh and upgraded schemas match.
- Repository: insert with and without account; `updateAccount`; duplicate
  account rejected; multiple `NULL`s allowed.
- Resolver: new user stores account; existing link refreshes account; a null
  account does not clear an existing value; `emp_id` fallback still fails closed.
- Provider: account is mapped; missing or empty account raises
  `AuthUnavailableError`.
- Fixtures: add `account` to `CompanySsoSession` and
  `ExternalCompanyIdentity` literals.

### Documentation

- Update the Company SSO contract sentence in `README.md` and
  `README.zh-TW.md` to mention `account`.
- Update the session-adapter section in
  `docs/operations/phase3-workspace-governance-cutover.md`.

## Decisions left to the builder

- Whether `UNIQUE(account)` or a non-unique index fits the company's account
  reuse policy.
- Whether to extend the Phase 3 bootstrap mapping with `account` now or defer it.
- Whether to refresh `account` on every login or only when it differs; an
  unconditional update is acceptable because login already writes
  `external_identity_links.last_seen_at`.

## Addendum (2026-10-29): `users.name_en`

The user asked for the English display name to ship in the same migration as
`account`. Migration 027 therefore also adds
`name_en VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL AFTER name`
with a non-empty check. It is nullable, not indexed, and is written by Company
SSO alongside `account`; a `null` value preserves any existing English name, so
local and Google logins cannot clear it.

Adding `name_en` changed migration 027's checksum. The migration is still
unreleased, so no deployed environment should have applied the earlier form.
Any local or shared database that did apply the earlier form must be rebuilt or
reset before applying this version; the migration runner will reject the
checksum mismatch rather than patch it in place.

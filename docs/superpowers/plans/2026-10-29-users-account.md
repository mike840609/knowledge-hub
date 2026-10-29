# Users.account for Company SSO Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a nullable, indexed `users.account` that only Company SSO writes, without changing local/Google login or identity-link behavior.

**Architecture:** Migration 027 adds the column and its unique B-tree index. `CompanySsoSession` and `ExternalCompanyIdentity` carry the account as trusted data. `HubIdentityResolver` writes it through two new `UserRepository` operations. `UserIdentity`, `upsertIdentity`, and `updateProfile` stay account-free, so local/Google paths cannot read or clear it.

**Tech Stack:** TypeScript, Next.js 15, MariaDB, Vitest, the in-repo migration runner.

**Spec:** `docs/superpowers/specs/2026-10-29-users-account-design.md`

## Global Constraints

- `account` is `VARCHAR(128) NULL`, `utf8mb4_unicode_ci`, with `UNIQUE (account)` and `CHECK (account IS NULL OR CHAR_LENGTH(account) > 0)`.
- `account` is stored profile data, never an identity-link key and never a fallback for `emp_id`.
- `UserIdentity` remains `{id, emp_id, name, org_code}`. Do not add `account` to it.
- `upsertIdentity` and `updateProfile` must never write or clear `account`.
- Local and Google login must keep working with `account = NULL`.
- `CompanySsoSession.account` is required and non-empty; a missing/empty value fails closed with `AuthUnavailableError`.
- `ExternalCompanyIdentity.account` is `string | null`; local and Google provide `null`.
- Autocomplete is prefix-only (`account LIKE 'prefix%'`); the unique index serves it. No FULLTEXT or separate index.
- Migrations are additive and apply to a populated database.
- Run integration tests with MariaDB up (`make db-up`) and use isolated databases.
- Commit after every task.

## Review Focus

1. A Company SSO session that omits `account` or returns an empty string must fail closed and must not create/update a user with an empty account.
2. Local login must leave `users.account` NULL and must not call the company resolver.
3. Google login must leave `users.account` NULL, and a later Google profile update must not clear an existing account.
4. A returning Company SSO user with a changed account must keep the same Hub user id, `emp_id`, and identity link; only `account` changes.
5. A legacy user whose `emp_id` matches but has no identity link must still fail `IDENTITY_LINK_REQUIRED`; the account must not be written and no link may be created.

---

### Task 1: Migration 027 and schema behavior

**Files:**
- Create: `src/infrastructure/database/mariadb/migrations/027-users-account.ts`
- Modify: `src/infrastructure/database/mariadb/migrations/index.ts`
- Test: `tests/integration/users-account.test.ts`

**Interfaces:**
- Consumes: the existing `Migration` type from `./types`.
- Produces: `usersAccountMigration: Migration` (version 27, name `"users-account"`), registered at the end of the `migrations` array.
- Produces: `users.account`, nullable, unique, non-empty when present.

- [ ] **Step 1: Write the failing migration test**

Create `tests/integration/users-account.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { migrations } from "@/infrastructure/database/mariadb/migrations";
import { runMigrations, type IsolatedDatabaseHandle } from "../../scripts/db/migrate";
import { disposeIsolatedDatabase, provisionIsolatedDatabase } from "../../scripts/db/test-database";
import { uuidv7 } from "@/shared/ids/uuidv7";

let handle: IsolatedDatabaseHandle;
let pool: Pool;

beforeAll(async () => {
  handle = await provisionIsolatedDatabase("test");
  pool = createDatabasePool({ ...databaseConfig("test"), database: handle.databaseName });
});

afterAll(async () => {
  await pool?.end();
  if (handle) await disposeIsolatedDatabase(handle);
});

describe("users.account schema", () => {
  it("adds the column to populated databases without changing existing rows", async () => {
    await runMigrations(pool, migrations, { to: 26 });
    const legacyId = uuidv7();
    await pool.query(
      "INSERT INTO users (id, emp_id, name, org_code) VALUES (?, 'LEGACY-ACCOUNT-1', 'Legacy User', 'RD')",
      [legacyId],
    );

    await runMigrations(pool);

    const [column] = await pool.query<{ Type: string; Null: string; Key: string }[]>(
      "SHOW COLUMNS FROM users LIKE 'account'",
    );
    expect(column).toMatchObject({ Type: "varchar(128)", Null: "YES", Key: "UNI" });

    const [legacy] = await pool.query<{ account: string | null }[]>(
      "SELECT account FROM users WHERE id = ?",
      [legacyId],
    );
    expect(legacy.account).toBeNull();

    const indexes = await pool.query<{ Non_unique: number; Column_name: string }[]>(
      "SHOW INDEX FROM users WHERE Key_name = 'uq_users_account'",
    );
    expect(indexes).toHaveLength(1);
    expect(indexes[0]).toMatchObject({ Non_unique: 0, Column_name: "account" });
  });

  it("allows multiple NULLs but rejects duplicate and empty accounts", async () => {
    const insert = (empId: string, account: string | null) =>
      pool.query("INSERT INTO users (id, emp_id, account, name, org_code) VALUES (?, ?, ?, 'User', 'RD')", [
        uuidv7(),
        empId,
        account,
      ]);

    await insert("NULL-ACCOUNT-1", null);
    await insert("NULL-ACCOUNT-2", null);
    await insert("DUP-ACCOUNT-1", "alice");

    await expect(insert("DUP-ACCOUNT-2", "alice")).rejects.toMatchObject({ code: "ER_DUP_ENTRY" });
    await expect(insert("DUP-ACCOUNT-3", "ALICE")).rejects.toMatchObject({ code: "ER_DUP_ENTRY" });
    await expect(insert("EMPTY-ACCOUNT-1", "")).rejects.toThrow(/CONSTRAINT|Check/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --config vitest.integration.config.ts tests/integration/users-account.test.ts`

Expected: FAIL because `users.account` does not exist (or the migration at version 27 is missing).

- [ ] **Step 3: Add migration 027 and register it**

Create `src/infrastructure/database/mariadb/migrations/027-users-account.ts`:

```ts
import type { Migration } from "./types";

/**
 * Company SSO account names. Nullable because existing Hub users and
 * local/Google identities have no company account. The unique B-tree index
 * also serves future prefix autocomplete for mentions.
 */
export const usersAccountMigration: Migration = {
  version: 27,
  name: "users-account",
  statements: [
    `ALTER TABLE users
      ADD COLUMN account VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL AFTER emp_id,
      ADD CONSTRAINT uq_users_account UNIQUE (account),
      ADD CONSTRAINT ck_users_account_nonempty CHECK (account IS NULL OR CHAR_LENGTH(account) > 0)`,
  ],
};
```

In `src/infrastructure/database/mariadb/migrations/index.ts`, import `usersAccountMigration` from `"./027-users-account"` and append it after `documentPageIconMigration` in the `migrations` array.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run --config vitest.integration.config.ts tests/integration/users-account.test.ts`

Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/database/mariadb/migrations/027-users-account.ts \
  src/infrastructure/database/mariadb/migrations/index.ts \
  tests/integration/users-account.test.ts
git commit -m "feat(db): add users.account for company SSO"
```

---

### Task 2: Repository persistence and null preservation

**Files:**
- Modify: `src/modules/identity/ports/user-repository.ts`
- Modify: `src/infrastructure/database/mariadb/repositories/users.ts`
- Test: `tests/integration/users-account.test.ts`

**Interfaces:**
- Consumes: `users.account` from Task 1.
- Produces: `insert(identity: UserIdentity, account?: string | null): Promise<void>`.
- Produces: `updateAccount(id: string, account: string): Promise<void>`.
- Guarantees: `upsertIdentity` and `updateProfile` do not touch `account`.

- [ ] **Step 1: Add failing repository tests**

Add these imports to the top of `tests/integration/users-account.test.ts`:

```ts
import { MariaDbUserRepository } from "@/infrastructure/database/mariadb/repositories/users";
import type { UserIdentity } from "@/modules/identity/domain/user-identity";
```

Then append the following to the same file:

```ts
function identity(empId: string): UserIdentity {
  return { id: uuidv7(), emp_id: empId, name: "Account User", org_code: "RD" };
}

describe("MariaDbUserRepository account writes", () => {
  it("inserts an account and leaves it NULL when omitted", async () => {
    const users = new MariaDbUserRepository(pool);
    const withAccount = identity(`ACC-WITH-${uuidv7()}`);
    const withoutAccount = identity(`ACC-WITHOUT-${uuidv7()}`);
    const account = `alice-${uuidv7()}`;

    await users.insert(withAccount, account);
    await users.insert(withoutAccount);

    const rows = await pool.query<{ id: string; account: string | null }[]>(
      "SELECT id, account FROM users WHERE id IN (?, ?)",
      [withAccount.id, withoutAccount.id],
    );
    expect(rows.find((row) => row.id === withAccount.id)?.account).toBe(account);
    expect(rows.find((row) => row.id === withoutAccount.id)?.account).toBeNull();
  });

  it("updates only the account and never clears it through upsert or profile sync", async () => {
    const users = new MariaDbUserRepository(pool);
    const user = identity(`ACC-KEEP-${uuidv7()}`);
    const before = `alice-before-${uuidv7()}`;
    const after = `alice-after-${uuidv7()}`;

    await users.insert(user, before);
    await users.updateAccount(user.id, after);
    await users.upsertIdentity({ ...user, name: "Renamed" });
    await users.updateProfile(user.id, { name: "Renamed Again", org_code: "OPS" });

    const [row] = await pool.query<{ account: string; name: string; org_code: string }[]>(
      "SELECT account, name, org_code FROM users WHERE id = ?",
      [user.id],
    );
    expect(row).toMatchObject({ account: after, name: "Renamed Again", org_code: "OPS" });
  });

  it("rejects a duplicate account on insert or update", async () => {
    const users = new MariaDbUserRepository(pool);
    const first = identity(`ACC-FIRST-${uuidv7()}`);
    const second = identity(`ACC-SECOND-${uuidv7()}`);
    const shared = `shared-${uuidv7()}`;

    await users.insert(first, shared);
    await users.insert(second, `second-${uuidv7()}`);

    await expect(users.insert(identity(`ACC-THIRD-${uuidv7()}`), shared)).rejects.toMatchObject({
      code: "ER_DUP_ENTRY",
    });
    await expect(users.updateAccount(second.id, shared)).rejects.toMatchObject({
      code: "ER_DUP_ENTRY",
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --config vitest.integration.config.ts tests/integration/users-account.test.ts`

Expected: FAIL because `insert` does not accept an account and `updateAccount` does not exist.

- [ ] **Step 3: Implement the repository contract and MariaDB adapter**

In `src/modules/identity/ports/user-repository.ts`:

- Change `insert` to `insert(identity: UserIdentity, account?: string | null): Promise<void>;`.
- Add `updateAccount(id: string, account: string): Promise<void>;` with a comment that it writes only the trusted company account and is never called by local/Google paths.
- Keep the existing `upsertIdentity` and `updateProfile` signatures unchanged.

In `src/infrastructure/database/mariadb/repositories/users.ts`:

```ts
async insert(identity: UserIdentity, account: string | null = null): Promise<void> {
  await this.connection.query(
    "INSERT INTO users (id, emp_id, account, name, org_code) VALUES (?, ?, ?, ?, ?)",
    [identity.id, identity.emp_id, account, identity.name, identity.org_code],
  );
}

async updateAccount(id: string, account: string): Promise<void> {
  await this.connection.query("UPDATE users SET account = ? WHERE id = ?", [account, id]);
}
```

Do not change `upsertIdentity` or `updateProfile`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --config vitest.integration.config.ts tests/integration/users-account.test.ts`

Expected: PASS (5 tests).

- [ ] **Step 5: Run the typecheck**

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/modules/identity/ports/user-repository.ts \
  src/infrastructure/database/mariadb/repositories/users.ts \
  tests/integration/users-account.test.ts
git commit -m "feat(identity): persist users.account in the user repository"
```

---

### Task 3: Company SSO contract and provider mapping

**Files:**
- Modify: `src/modules/identity/ports/company-sso-session-reader.ts`
- Modify: `src/modules/identity/domain/external-company-identity.ts`
- Modify: `src/infrastructure/identity/company-sso-identity-provider.ts`
- Modify: `src/infrastructure/identity/google-identity-provider.ts`
- Modify: `src/infrastructure/identity/local-identity-provider.ts`
- Modify: `src/server/google-identity.ts`
- Modify: `tests/unit/phase3-identity-provider.test.ts`
- Modify: `tests/unit/google-identity-provider.test.ts`
- Modify: `tests/unit/phase3-workspace-capabilities.test.ts`
- Modify: `tests/unit/phase3-identity-resolver-retry.test.ts`
- Modify: `tests/unit/sync-caller-identity.test.ts`
- Modify: `tests/unit/trusted-caller-google.test.ts`
- Modify: `tests/integration/phase3-bootstrap.test.ts`
- Modify: `tests/integration/phase3-identity-resolution.test.ts`
- Modify: `tests/integration/phase3-request-authorization.test.ts`
- Modify: `tests/e2e/fixtures/phase3-identities.ts`
- Modify: `README.md`
- Modify: `README.zh-TW.md`
- Modify: `docs/operations/phase3-workspace-governance-cutover.md`

**Interfaces:**
- Produces: `CompanySsoSession.account: string` (required).
- Produces: `ExternalCompanyIdentity.account: string | null`.
- Produces: `CompanySsoIdentityProvider` maps and validates `session.account`.
- Produces: local and Google claims carry `account: null`.
- Guarantees: missing or empty company account raises `AuthUnavailableError` before any user write.

- [ ] **Step 1: Write the failing provider tests**

In `tests/unit/phase3-identity-provider.test.ts`:

1. Add `account: string` to the `trackingReader` parameter type.
2. Add an `account` value to every `trackingReader` call and every `CompanySsoSession` literal.
3. Add `account` to the expected `claims.externalIdentity` objects.
4. Add `account: null` to the expected local claims object.
5. Add `"account"` to the existing `it.each(["subject", "emp_id", "name"])` missing-field list, and add `account: "a"` to that test's session object so `[field]: ""` can override it.
6. Add a test for a wholly missing account:

```ts
it("fails closed when the company session omits account", async () => {
  const reader = {
    readSession: async () => ({
      subject: "s",
      emp_id: "e",
      name: "n",
      org_code: "o",
      externalGroupIds: [],
    }),
  };
  await expect(
    new CompanySsoIdentityProvider(reader as never, { provider: "company-sso", teamCreateGroupIds: [] }).getCurrentClaims(),
  ).rejects.toBeInstanceOf(AuthUnavailableError);
});
```

In `tests/unit/google-identity-provider.test.ts`, extend the claims assertion:

```ts
expect(claims.externalIdentity).toMatchObject({
  provider: "google",
  subject: "u1",
  emp_id: "DEMO-ABC1234567",
  account: null,
  name: "Wang",
  org_code: "DEMO",
});
```

- [ ] **Step 2: Run the unit tests to verify they fail**

Run: `npx vitest run --config vitest.config.ts tests/unit/phase3-identity-provider.test.ts tests/unit/google-identity-provider.test.ts`

Expected: FAIL because `CompanySsoSession.account` and `ExternalCompanyIdentity.account` do not exist.

- [ ] **Step 3: Add the contract fields and provider mapping**

`src/modules/identity/ports/company-sso-session-reader.ts`:

```ts
export type CompanySsoSession = {
  subject: string;
  emp_id: string;
  account: string;
  name: string;
  org_code: string;
  externalGroupIds: readonly string[];
};
```

`src/modules/identity/domain/external-company-identity.ts`:

```ts
export type ExternalCompanyIdentity = {
  provider: string;
  subject: string;
  emp_id: string;
  account: string | null;
  name: string;
  org_code: string;
};
```

Update the doc comment to say `account` is stored profile data, never the link key, and is `null` for providers without a company account.

In `src/infrastructure/identity/company-sso-identity-provider.ts`:

- Add `assertSessionField(session.account, "account");` next to the other field assertions.
- Add `account: session.account` to the returned `externalIdentity`.

In `src/infrastructure/identity/google-identity-provider.ts`, `src/infrastructure/identity/local-identity-provider.ts`, and `src/server/google-identity.ts`, add `account: null` to every `externalIdentity` object.

- [ ] **Step 4: Update every remaining compile-time literal**

Run `npm run typecheck` to list them, then add `account` to each:

- `tests/unit/phase3-workspace-capabilities.test.ts` → `account: null` (or a concrete account).
- `tests/unit/phase3-identity-resolver-retry.test.ts` → `account: "retry-account"`.
- `tests/unit/sync-caller-identity.test.ts` → `account: null`.
- `tests/unit/trusted-caller-google.test.ts` → `account: null`.
- `tests/integration/phase3-bootstrap.test.ts` → `account: \`account-${partial.empId}\``.
- `tests/integration/phase3-identity-resolution.test.ts` → add `account: \`acct-${empId}\`` to the object returned by the `claims` helper. Task 4 extends that helper with an explicit account parameter.
- `tests/integration/phase3-request-authorization.test.ts` → add `account: "owner-account"` and `account: "group-account"` to the two session literals.
- `tests/e2e/fixtures/phase3-identities.ts` → `account: \`p3-${persona}\`` in `phase3Session`.

- [ ] **Step 5: Update the Company SSO documentation**

- `README.md`: in the Company SSO adapter paragraph, add: “The reader must return the company account name as `account` alongside the subject, employee id, name, org code, and group IDs.”
- `README.zh-TW.md`: add: 「reader 必須在回傳的 subject、員工編號、姓名、組織代碼與群組 ID 之外，一併回傳公司帳號名稱 `account`。」
- `docs/operations/phase3-workspace-governance-cutover.md`: in “Connecting the company session adapter later”, change “return the provider-issued subject, enterprise profile, and validated group IDs” to “return the provider-issued subject, company account name, enterprise profile, and validated group IDs.”

- [ ] **Step 6: Run the unit tests and typecheck**

Run:

```bash
npx vitest run --config vitest.config.ts tests/unit/phase3-identity-provider.test.ts tests/unit/google-identity-provider.test.ts
npm run typecheck
```

Expected: both PASS.

- [ ] **Step 7: Commit**

```bash
git add src/modules/identity/ports/company-sso-session-reader.ts \
  src/modules/identity/domain/external-company-identity.ts \
  src/infrastructure/identity/company-sso-identity-provider.ts \
  src/infrastructure/identity/google-identity-provider.ts \
  src/infrastructure/identity/local-identity-provider.ts \
  src/server/google-identity.ts \
  tests/unit/phase3-identity-provider.test.ts \
  tests/unit/google-identity-provider.test.ts \
  tests/unit/phase3-workspace-capabilities.test.ts \
  tests/unit/phase3-identity-resolver-retry.test.ts \
  tests/unit/sync-caller-identity.test.ts \
  tests/unit/trusted-caller-google.test.ts \
  tests/integration/phase3-bootstrap.test.ts \
  tests/integration/phase3-identity-resolution.test.ts \
  tests/integration/phase3-request-authorization.test.ts \
  tests/e2e/fixtures/phase3-identities.ts \
  README.md README.zh-TW.md \
  docs/operations/phase3-workspace-governance-cutover.md
git commit -m "feat(identity): carry company SSO account in trusted claims"
```

---

### Task 4: Resolver writes and refreshes the account

**Files:**
- Modify: `src/modules/identity/application/hub-identity-resolver.ts`
- Modify: `tests/integration/phase3-identity-resolution.test.ts`
- Modify: `tests/integration/phase3-request-authorization.test.ts`

**Interfaces:**
- Consumes: `UserRepository.insert(identity, account?)` and `updateAccount(id, account)` from Task 2.
- Consumes: `ExternalCompanyIdentity.account` from Task 3.
- Produces: on link hit, `updateAccount` only when `external.account !== null`.
- Produces: on user creation, `insert(user, external.account)`.
- Guarantees: `account` never affects link lookup or the `emp_id` fail-closed path.

- [ ] **Step 1: Update the resolver tests**

In `tests/integration/phase3-identity-resolution.test.ts`, change the `claims` helper to accept an account:

```ts
function claims(
  provider: string,
  subject: string,
  empId: string,
  name = "SSO User",
  org = "RD",
  account: string | null = `acct-${empId}`,
): ExternalCompanyIdentity {
  return { provider, subject, emp_id: empId, account, name, org_code: org };
}
```

Add these tests inside the existing `describe("Hub runtime identity resolution")`:

```ts
it("stores the trusted account when creating a company user", async () => {
  const tag = uuidv7();
  const empId = `EMP-ACC-CREATE-${tag}`;
  const account = `alice-create-${tag}`;
  const resolved = await resolver.resolve(claims("company-sso", `subject-acc-create-${tag}`, empId, "Account User", "RD", account));

  const [row] = await pool.query<{ account: string | null }[]>("SELECT account FROM users WHERE id = ?", [resolved.id]);
  expect(row.account).toBe(account);
});

it("refreshes the account on an existing link without changing the Hub user", async () => {
  const tag = uuidv7();
  const provider = "company-sso";
  const subject = `subject-acc-refresh-${tag}`;
  const empId = `EMP-ACC-REFRESH-${tag}`;
  const before = `alice-refresh-${tag}`;
  const after = `alice-refresh-2-${tag}`;
  const hubUserId = await seedUser(empId, "Account User");
  await seedLink(provider, subject, hubUserId);
  await pool.query("UPDATE users SET account = ? WHERE id = ?", [before, hubUserId]);

  const resolved = await resolver.resolve(claims(provider, subject, empId, "Account User", "RD", after));

  expect(resolved.id).toBe(hubUserId);
  expect(resolved.emp_id).toBe(empId);
  const [row] = await pool.query<{ account: string | null }[]>("SELECT account FROM users WHERE id = ?", [hubUserId]);
  expect(row.account).toBe(after);
});

it("does not clear an existing account when the external identity has none", async () => {
  const tag = uuidv7();
  const provider = "company-sso";
  const subject = `subject-acc-null-${tag}`;
  const empId = `EMP-ACC-NULL-${tag}`;
  const account = `alice-null-${tag}`;
  const hubUserId = await seedUser(empId, "Account User");
  await seedLink(provider, subject, hubUserId);
  await pool.query("UPDATE users SET account = ? WHERE id = ?", [account, hubUserId]);

  await resolver.resolve(claims(provider, subject, empId, "Account User", "RD", null));

  const [row] = await pool.query<{ account: string | null }[]>("SELECT account FROM users WHERE id = ?", [hubUserId]);
  expect(row.account).toBe(account);
});
```

Extend existing test C (“missing link plus existing emp_id fails IDENTITY_LINK_REQUIRED”) with:

```ts
const [legacy] = await pool.query<{ account: string | null }[]>("SELECT account FROM users WHERE id = ?", [hubUserId]);
expect(legacy.account).toBeNull();
```

In `tests/integration/phase3-request-authorization.test.ts`, add this test (the session literals already carry `account` from Task 3):

```ts
it("persists the trusted company account through the request bootstrap", async () => {
  const { caller } = await services.establishTrustedCaller();
  const [row] = await pool.query<{ account: string | null }[]>(
    "SELECT account FROM users WHERE id = ?",
    [caller.identity.id],
  );
  expect(row.account).toBe("owner-account");
});
```

The `beforeEach` session uses `account: "owner-account"` and the `team()` session uses `account: "group-account"`.

- [ ] **Step 2: Run the integration tests to verify they fail**

Run: `npm run test:integration`

Expected: FAIL because the resolver does not write or refresh `account`.

- [ ] **Step 3: Implement resolver writes**

In `src/modules/identity/application/hub-identity-resolver.ts`:

1. Change `assertTrustedExternalIdentity` so the required-field loop excludes `account`:

```ts
const fields: Array<Exclude<keyof ExternalCompanyIdentity, "account">> = [
  "provider",
  "subject",
  "emp_id",
  "name",
  "org_code",
];
for (const field of fields) {
  if (typeof external[field] !== "string" || external[field].length === 0) {
    throw new IdentityError(`Trusted company identity field ${field} must be a non-empty string.`);
  }
}
if (external.account !== null && (typeof external.account !== "string" || external.account.length === 0)) {
  throw new IdentityError("Trusted company identity field account must be null or a non-empty string.");
}
```

2. In the existing-link branch, after the name/org sync, add:

```ts
if (external.account !== null) {
  await repositories.users.updateAccount(user.id, external.account);
}
```

3. In the creation branch, change the insert to:

```ts
await repositories.users.insert(user, external.account);
```

Do not change the `findByEmpId` fail-closed branch.

- [ ] **Step 4: Run the integration tests to verify they pass**

Run: `npm run test:integration`

Expected: PASS, including the new account tests and the existing identity-resolution, bootstrap, and request-authorization suites.

- [ ] **Step 5: Run typecheck and lint**

Run:

```bash
npm run typecheck
npm run lint
```

Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add src/modules/identity/application/hub-identity-resolver.ts \
  tests/integration/phase3-identity-resolution.test.ts \
  tests/integration/phase3-request-authorization.test.ts
git commit -m "feat(identity): write company SSO account during resolution"
```

---

### Task 5: Regression coverage for local and Google login

**Files:**
- Modify: `tests/integration/google-identity.test.ts`
- Modify: `tests/integration/phase3-request-authorization.test.ts`

**Interfaces:**
- Consumes: the resolver and repository behavior from Tasks 2–4.
- Produces: proof that local and Google paths never write or clear `account`.

- [ ] **Step 1: Add failing regression tests**

In `tests/integration/google-identity.test.ts`, extend the existing test:

```ts
const [created] = await pool.query<{ account: string | null }[]>(
  "SELECT account FROM users WHERE id = ?",
  [first.id],
);
expect(created.account).toBeNull();

// A later Google profile update must not write or clear an account.
const existingAccount = `google-existing-${subject}`;
await pool.query("UPDATE users SET account = ? WHERE id = ?", [existingAccount, first.id]);
const third = await resolveGoogleIdentity(
  { subject, name: "Third Name", email: "first@example.com" },
  unitOfWork,
);
expect(third.id).toBe(first.id);
const [afterUpdate] = await pool.query<{ account: string | null }[]>(
  "SELECT account FROM users WHERE id = ?",
  [first.id],
);
expect(afterUpdate.account).toBe(existingAccount);
```

In `tests/integration/phase3-request-authorization.test.ts`, in the existing “uses Local bootstrap for actual adapters without requiring company SSO” test, add:

```ts
const [localUser] = await pool.query<{ account: string | null }[]>(
  "SELECT account FROM users WHERE id = ?",
  [id],
);
expect(localUser.account).toBeNull();
```

- [ ] **Step 2: Run the tests and record the baseline**

Run: `npm run test:integration`

Expected: PASS if Task 4 preserved the local/Google paths. This task is a regression guard, not a new-behavior TDD cycle: a green run is the expected outcome. If it fails, the failure identifies a path that now writes or clears `account`.

- [ ] **Step 3: Fix only the offending path**

The expected implementation already preserves `account` because `upsertIdentity` and `updateProfile` do not touch it and the resolver skips `updateAccount` when `external.account === null`. If a test fails, fix the production path rather than weakening the assertion. Do not add `account` to `UserIdentity` or to `updateProfile`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:integration`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/integration/google-identity.test.ts \
  tests/integration/phase3-request-authorization.test.ts
git commit -m "test(identity): prove local and Google login never touch account"
```

---

### Task 6: Final verification

**Files:**
- No source changes expected.

- [ ] **Step 1: Run the complete DB-free gate**

Run: `make verify`

Expected: PASS (unit tests, typecheck, lint, build).

- [ ] **Step 2: Run the full integration suite**

Run: `make test-integration`

Expected: PASS.

- [ ] **Step 3: Inspect the final diff**

Run:

```bash
git status --short
git log --oneline -6
git diff --stat main...HEAD
```

Expected: only the migration, identity contract, repository, resolver, tests, and documentation files from this plan. No change to `UserIdentity`, `upsertIdentity`, `updateProfile`, or the `findByEmpId` fail-closed branch.

- [ ] **Step 4: Commit any remaining verification-only changes**

If Step 3 shows uncommitted changes, commit them with a message describing the fix. Otherwise, no commit is needed.

---

## Addendum (2026-10-29): `name_en` in migration 027

The user requested an English display-name column in the same migration as
`account`. Migration 027 now also adds
`name_en VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL AFTER name`
with `ck_users_name_en_nonempty`. The schema test in
`tests/integration/users-account.test.ts` asserts the column is nullable and
rejects an empty value. No Company SSO contract, resolver, or repository change
was made for `name_en` in this pass; it is a reserved column until a write path
is requested.

Because 027 is unreleased, the checksum change is safe for the branch. Any local
database that already applied the earlier 027 must be rebuilt or reset; the
migration runner rejects a checksum mismatch.

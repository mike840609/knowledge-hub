import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { migrations } from "@/infrastructure/database/mariadb/migrations";
import { runMigrations, type IsolatedDatabaseHandle } from "../../scripts/db/migrate";
import { disposeIsolatedDatabase, provisionIsolatedDatabase } from "../../scripts/db/test-database";
import {
  bootstrapWorkspaceGovernance,
  type GovernanceBootstrapConfig,
} from "../../scripts/db/bootstrap-phase3-workspace-governance";
import {
  bootstrapIdentityLinks,
  type LegacyIdentityLinkBootstrapEntry,
} from "../../scripts/db/bootstrap-phase3-identity-links";
import { HubIdentityResolver } from "@/modules/identity/application/hub-identity-resolver";
import { PersonalWorkspaceService } from "@/modules/workspaces/application/personal-workspace-service";
import { establishTrustedCaller } from "@/server/trusted-caller";
import type { IdentityProvider } from "@/modules/identity/ports/identity-provider";
import type { TrustedIdentityClaims } from "@/modules/identity/domain/trusted-identity-claims";
import { isUuid, uuidv7 } from "@/shared/ids/uuidv7";

let handle: IsolatedDatabaseHandle | undefined;
let pool: Pool | undefined;

beforeEach(async () => {
  handle = await provisionIsolatedDatabase("test");
  const previous = process.env.KM_TEST_DB_NAME;
  process.env.KM_TEST_DB_NAME = handle.databaseName;
  try {
    pool = createDatabasePool(databaseConfig("test"));
  } finally {
    if (previous === undefined) delete process.env.KM_TEST_DB_NAME;
    else process.env.KM_TEST_DB_NAME = previous;
  }
  await runMigrations(pool, migrations, { to: 8 });
});

afterEach(async () => {
  if (pool) await pool.end();
  pool = undefined;
  if (handle) await disposeIsolatedDatabase(handle);
  handle = undefined;
});

function db(): Pool {
  if (!pool) throw new Error("Isolated test database is not provisioned.");
  return pool;
}

async function seedUser(name: string, empTag: string): Promise<{ id: string; empId: string }> {
  const id = uuidv7();
  const empId = `P3BOOT-${empTag}-${id.slice(0, 8)}`;
  await db().query("INSERT INTO users (id, emp_id, name, org_code) VALUES (?, ?, ?, 'RD')", [id, empId, name]);
  return { id, empId };
}

async function seedTeam(name: string): Promise<string> {
  const id = uuidv7();
  await db().query("INSERT INTO workspaces (id, name, workspace_type) VALUES (?, ?, 'TEAM')", [id, name]);
  return id;
}

async function seedMembership(workspaceId: string, userId: string, role: string | null, source: string | null): Promise<void> {
  await db().query("INSERT INTO workspace_memberships (workspace_id, user_id, role, membership_source) VALUES (?, ?, ?, ?)", [
    workspaceId,
    userId,
    role,
    source,
  ]);
}

async function membershipRow(workspaceId: string, userId: string): Promise<{ role: string | null; membership_source: string | null } | undefined> {
  const rows = await db().query<{ role: string | null; membership_source: string | null }[]>(
    "SELECT role, membership_source FROM workspace_memberships WHERE workspace_id = ? AND user_id = ?",
    [workspaceId, userId],
  );
  return rows[0];
}

async function directOwnerCount(workspaceId: string): Promise<number> {
  const rows = await db().query<{ count: number }[]>(
    "SELECT COUNT(*) AS count FROM workspace_memberships WHERE workspace_id = ? AND role = 'OWNER' AND membership_source = 'DIRECT'",
    [workspaceId],
  );
  return Number(rows[0].count);
}

function ownersConfig(entries: Record<string, string>): GovernanceBootstrapConfig {
  return { owners: entries };
}

function linkEntry(partial: Partial<LegacyIdentityLinkBootstrapEntry> & { hubUserId: string; expectedEmpId: string }): LegacyIdentityLinkBootstrapEntry {
  return {
    provider: "company-sso",
    subject: `bootstrap-subject-${uuidv7()}`,
    ...partial,
  };
}

async function linkCount(provider: string, subject: string): Promise<number> {
  const rows = await db().query<{ count: number }[]>(
    "SELECT COUNT(*) AS count FROM external_identity_links WHERE provider = ? AND subject_bytes = ?",
    [provider, Buffer.from(subject, "utf8")],
  );
  return Number(rows[0].count);
}

describe("Phase 3 governance bootstrap (explicit owners only)", () => {
  it("1. all-EDITOR Team without an explicit entry fails; with an explicit elevation entry the member becomes direct OWNER", async () => {
    const editor = await seedUser("Editor User", "EDIT");
    const workspaceId = await seedTeam("All Editor Team");
    await seedMembership(workspaceId, editor.id, "EDITOR", "DIRECT");

    await expect(bootstrapWorkspaceGovernance(db(), ownersConfig({}))).rejects.toThrow(/OWNER/i);

    const result = await bootstrapWorkspaceGovernance(db(), ownersConfig({ [workspaceId]: editor.id }));
    expect(result.teams).toBe(1);
    expect(await directOwnerCount(workspaceId)).toBe(1);
    expect(await membershipRow(workspaceId, editor.id)).toMatchObject({ role: "OWNER", membership_source: "DIRECT" });
  });

  it("2. zero-member Team without an explicit entry fails; with an explicit OWNER entry the membership is inserted", async () => {
    const owner = await seedUser("Lone Owner", "LONE");
    const workspaceId = await seedTeam("Empty Team");

    await expect(bootstrapWorkspaceGovernance(db(), ownersConfig({}))).rejects.toThrow(/OWNER/i);

    await bootstrapWorkspaceGovernance(db(), ownersConfig({ [workspaceId]: owner.id }));
    expect(await directOwnerCount(workspaceId)).toBe(1);
    expect(await membershipRow(workspaceId, owner.id)).toMatchObject({ role: "OWNER", membership_source: "DIRECT" });
  });

  it("3. unknown owner target fails: missing user and missing workspace", async () => {
    const workspaceId = await seedTeam("Orphan Team");

    await expect(bootstrapWorkspaceGovernance(db(), ownersConfig({ [workspaceId]: uuidv7() }))).rejects.toThrow(/unknown|exist/i);

    const owner = await seedUser("Real Owner", "REAL");
    await expect(bootstrapWorkspaceGovernance(db(), ownersConfig({ [uuidv7()]: owner.id }))).rejects.toThrow(/unknown|exist/i);

    expect(await directOwnerCount(workspaceId)).toBe(0);
  });

  it("4. NULL role/source rows fail until fixed or covered by an explicit entry", async () => {
    const legacy = await seedUser("Legacy Member", "LEG");
    const other = await seedUser("Other Member", "OTH");
    const workspaceId = await seedTeam("Null Role Team");
    await seedMembership(workspaceId, legacy.id, null, null);
    await seedMembership(workspaceId, other.id, "EDITOR", "DIRECT");

    await expect(bootstrapWorkspaceGovernance(db(), ownersConfig({}))).rejects.toThrow(/role|source|OWNER/i);

    await bootstrapWorkspaceGovernance(db(), ownersConfig({ [workspaceId]: legacy.id }));
    expect(await membershipRow(workspaceId, legacy.id)).toMatchObject({ role: "OWNER", membership_source: "DIRECT" });
    expect(await directOwnerCount(workspaceId)).toBe(1);
  });

  it("4b. uncovered NULL role/source rows still fail even when the Team has an explicit owner", async () => {
    const owner = await seedUser("Team Owner", "OWN");
    const stale = await seedUser("Stale Member", "STALE");
    const workspaceId = await seedTeam("Stale Null Team");
    await seedMembership(workspaceId, owner.id, "OWNER", "DIRECT");
    await seedMembership(workspaceId, stale.id, null, null);

    await expect(bootstrapWorkspaceGovernance(db(), ownersConfig({}))).rejects.toThrow(/role|source/i);
  });

  it("5. successful explicit owner bootstrap leaves every legacy Team with direct OWNER >= 1 and never guesses", async () => {
    const healthyOwner = await seedUser("Healthy Owner", "HEALTHY");
    const healthyEditor = await seedUser("Healthy Editor", "HEDIT");
    const healthyTeam = await seedTeam("Healthy Team");
    await seedMembership(healthyTeam, healthyOwner.id, "OWNER", "DIRECT");
    await seedMembership(healthyTeam, healthyEditor.id, "EDITOR", "DIRECT");

    const elevated = await seedUser("Elevated Owner", "ELEV");
    const fixerTeam = await seedTeam("Needs Owner Team");
    await seedMembership(fixerTeam, elevated.id, "VIEWER", "DIRECT");

    const newcomer = await seedUser("Newcomer Owner", "NEW");
    const emptyTeam = await seedTeam("Empty Team Two");

    const result = await bootstrapWorkspaceGovernance(
      db(),
      ownersConfig({ [fixerTeam]: elevated.id, [emptyTeam]: newcomer.id }),
    );
    expect(result.teams).toBe(3);
    for (const workspaceId of [healthyTeam, fixerTeam, emptyTeam]) {
      expect(await directOwnerCount(workspaceId)).toBeGreaterThanOrEqual(1);
    }
    expect(await membershipRow(healthyTeam, healthyEditor.id)).toMatchObject({ role: "EDITOR", membership_source: "DIRECT" });
    expect(await membershipRow(fixerTeam, elevated.id)).toMatchObject({ role: "OWNER", membership_source: "DIRECT" });

    const rerun = await bootstrapWorkspaceGovernance(
      db(),
      ownersConfig({ [fixerTeam]: elevated.id, [emptyTeam]: newcomer.id }),
    );
    expect(rerun.teams).toBe(3);
  });
});

describe("Phase 3 legacy identity-link bootstrap", () => {
  it("6. missing Hub user target fails without writing a link", async () => {
    const entry = linkEntry({ hubUserId: uuidv7(), expectedEmpId: "EMP-MISSING-1" });
    await expect(bootstrapIdentityLinks(db(), [entry])).rejects.toThrow(/exist/i);
    expect(await linkCount(entry.provider, entry.subject)).toBe(0);
  });

  it("7. expected_emp_id mismatch fails closed and writes nothing (safety assertion, not a link key)", async () => {
    const user = await seedUser("Safety User", "SAFE");
    const entry = linkEntry({ hubUserId: user.id, expectedEmpId: "EMP-WRONG-999" });
    await expect(bootstrapIdentityLinks(db(), [entry])).rejects.toThrow(/emp_id|expected/i);
    expect(await linkCount(entry.provider, entry.subject)).toBe(0);
  });

  it("8. duplicate provider+subject and duplicate provider+hub_user conflicts fail closed", async () => {
    const first = await seedUser("First User", "FIRST");
    const second = await seedUser("Second User", "SECOND");
    const subject = `conflict-subject-${uuidv7()}`;
    await bootstrapIdentityLinks(db(), [{ provider: "company-sso", subject, hubUserId: first.id, expectedEmpId: first.empId }]);

    await expect(
      bootstrapIdentityLinks(db(), [{ provider: "company-sso", subject, hubUserId: second.id, expectedEmpId: second.empId }]),
    ).rejects.toThrow(/conflict|duplicate|already/i);

    await expect(
      bootstrapIdentityLinks(db(), [{ provider: "company-sso", subject: `other-subject-${uuidv7()}`, hubUserId: first.id, expectedEmpId: first.empId }]),
    ).rejects.toThrow(/conflict|duplicate|already/i);

    expect(await linkCount("company-sso", subject)).toBe(1);
  });

  it("9. identical rerun is idempotent and exact subject bytes are preserved", async () => {
    const user = await seedUser("Idempotent User", "IDEM");
    const entries = [linkEntry({ hubUserId: user.id, expectedEmpId: user.empId })];
    const first = await bootstrapIdentityLinks(db(), entries);
    expect(first.linked).toBe(1);
    const second = await bootstrapIdentityLinks(db(), entries);
    expect(second.linked).toBe(0);
    expect(second.alreadyLinked).toBe(1);
    expect(await linkCount(entries[0].provider, entries[0].subject)).toBe(1);

    const stored = await db().query<{ subject_bytes: Buffer }[]>(
      "SELECT subject_bytes FROM external_identity_links WHERE provider = ? AND hub_user_id = ?",
      [entries[0].provider, user.id],
    );
    expect(stored).toHaveLength(1);
    expect(Buffer.from(entries[0].subject, "utf8").equals(Buffer.from(stored[0].subject_bytes))).toBe(true);
  });
});

function companySsoClaims(partial: { subject: string; empId: string; name?: string }): TrustedIdentityClaims {
  return {
    externalIdentity: {
      provider: "company-sso",
      subject: partial.subject,
      emp_id: partial.empId,
      name: partial.name ?? `SSO User ${partial.subject.slice(0, 8)}`,
      org_code: "RD",
    },
    validatedExternalGroupIds: ["sso-group-eng"],
    platformCapabilities: [],
    refreshedAt: new Date(),
  };
}

/** Test double for a Company SSO provider: getCurrentIdentity always throws, claims are server-side. */
function stubCompanySsoProvider(claims: TrustedIdentityClaims): IdentityProvider {
  return {
    async getCurrentIdentity(): Promise<never> {
      throw new Error("Company SSO identities must resolve through HubIdentityResolver.");
    },
    async getCurrentClaims(): Promise<TrustedIdentityClaims> {
      return claims;
    },
  };
}

async function userCount(): Promise<number> {
  const rows = await db().query<{ count: number }[]>("SELECT COUNT(*) AS count FROM users");
  return Number(rows[0].count);
}

async function personalCountForOwner(ownerId: string): Promise<number> {
  const rows = await db().query<{ count: number }[]>("SELECT COUNT(*) AS count FROM workspaces WHERE personal_owner_user_id = ?", [ownerId]);
  return Number(rows[0].count);
}

describe("Phase 3 trusted caller bootstrap (Task 7)", () => {
  it("10. claims resolve to a new UUIDv7 Hub user, persist only the resolver output, and provision My Space", async () => {
    const unitOfWork = new MariaDbUnitOfWork(db());
    const subject = `sso-subject-${uuidv7()}`;
    const empId = `P3SSO-${subject.slice(0, 8)}`;
    const established = await establishTrustedCaller({
      provider: stubCompanySsoProvider(companySsoClaims({ subject, empId })),
      resolver: new HubIdentityResolver(unitOfWork),
      personalWorkspaces: new PersonalWorkspaceService(unitOfWork),
      unitOfWork,
    });

    expect(isUuid(established.identity.id)).toBe(true);
    expect(established.identity.id).not.toBe(subject);
    expect(established.identity.emp_id).toBe(empId);
    expect(established.principal.identity).toMatchObject({ id: established.identity.id, emp_id: empId });
    expect([...established.principal.validatedExternalGroupIds]).toEqual(["sso-group-eng"]);
    expect(established.caller.identity).toMatchObject({ id: established.identity.id });
    expect([...established.caller.validatedExternalGroupIds]).toEqual(["sso-group-eng"]);
    expect(established.personalWorkspace.name).toBe("My Space");
    expect(established.personalWorkspace.workspaceType).toBe("PERSONAL");
    expect(established.personalWorkspace.personalOwnerUserId).toBe(established.identity.id);

    const stored = await db().query<{ id: string; emp_id: string; name: string }[]>("SELECT id, emp_id, name FROM users WHERE id = ?", [
      established.identity.id,
    ]);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ id: established.identity.id, emp_id: empId, name: established.identity.name });
    expect(await userCount()).toBe(1);
    expect(await personalCountForOwner(established.identity.id)).toBe(1);
  });

  it("11. deep-link and API entries reuse the same caller, user, and My Space", async () => {
    const unitOfWork = new MariaDbUnitOfWork(db());
    const subject = `sso-reuse-${uuidv7()}`;
    const empId = `P3SSO-R-${subject.slice(0, 8)}`;
    const dependencies = {
      provider: stubCompanySsoProvider(companySsoClaims({ subject, empId })),
      resolver: new HubIdentityResolver(unitOfWork),
      personalWorkspaces: new PersonalWorkspaceService(unitOfWork),
      unitOfWork,
    };

    const deepLink = await establishTrustedCaller(dependencies);
    const api = await establishTrustedCaller(dependencies);

    expect(api.identity.id).toBe(deepLink.identity.id);
    expect(api.caller.identity.id).toBe(deepLink.caller.identity.id);
    expect(api.personalWorkspace.id).toBe(deepLink.personalWorkspace.id);
    expect(await userCount()).toBe(1);
    expect(await personalCountForOwner(deepLink.identity.id)).toBe(1);
  });

  it("12. a different subject resolves to a different Hub user with its own My Space", async () => {
    const unitOfWork = new MariaDbUnitOfWork(db());
    const firstSubject = `sso-first-${uuidv7()}`;
    const secondSubject = `sso-second-${uuidv7()}`;
    const first = await establishTrustedCaller({
      provider: stubCompanySsoProvider(companySsoClaims({ subject: firstSubject, empId: `P3SSO-1-${firstSubject.slice(0, 8)}` })),
      resolver: new HubIdentityResolver(unitOfWork),
      personalWorkspaces: new PersonalWorkspaceService(unitOfWork),
      unitOfWork,
    });
    const second = await establishTrustedCaller({
      provider: stubCompanySsoProvider(companySsoClaims({ subject: secondSubject, empId: `P3SSO-2-${secondSubject.slice(0, 8)}` })),
      resolver: new HubIdentityResolver(unitOfWork),
      personalWorkspaces: new PersonalWorkspaceService(unitOfWork),
      unitOfWork,
    });

    expect(second.identity.id).not.toBe(first.identity.id);
    expect(second.personalWorkspace.id).not.toBe(first.personalWorkspace.id);
    expect(second.personalWorkspace.personalOwnerUserId).toBe(second.identity.id);
    expect(await userCount()).toBe(2);
  });

  it("13. colliding emp_id without a link fails closed and provisions nothing", async () => {
    const unitOfWork = new MariaDbUnitOfWork(db());
    const user = await seedUser("Collision Owner", "COLLIDE");
    const subject = `sso-collide-${uuidv7()}`;
    await expect(
      establishTrustedCaller({
        provider: stubCompanySsoProvider(companySsoClaims({ subject, empId: user.empId })),
        resolver: new HubIdentityResolver(unitOfWork),
        personalWorkspaces: new PersonalWorkspaceService(unitOfWork),
        unitOfWork,
      }),
    ).rejects.toThrow(/linked|bootstrap/i);
    expect(await personalCountForOwner(user.id)).toBe(0);
    expect(await userCount()).toBe(1);
  });
});

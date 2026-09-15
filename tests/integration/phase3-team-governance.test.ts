import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { migrations } from "@/infrastructure/database/mariadb/migrations";
import { runMigrations, type IsolatedDatabaseHandle } from "../../scripts/db/migrate";
import { disposeIsolatedDatabase, provisionIsolatedDatabase } from "../../scripts/db/test-database";
import type { CallerContext } from "@/modules/identity/domain/caller-context";
import type { UserIdentity } from "@/modules/identity/domain/user-identity";
import { TeamWorkspaceService, assertTeamMutationAllowed } from "@/modules/workspaces/application/team-workspace-service";
import { TeamGovernanceService } from "@/modules/workspaces/application/team-governance-service";
import {
  PersonalWorkspaceFrozenError,
  TeamCreationDeniedError,
  WorkspaceAccessDeniedError,
  WorkspaceLifecycleError,
  WorkspaceNotFoundError,
} from "@/modules/workspaces/domain/errors";
import { createDirectMembership } from "@/modules/workspaces/domain/workspace-membership";
import { createPersonalWorkspaceInsert, createTeamWorkspaceInsert } from "@/modules/workspaces/domain/workspace";
import { uuidv7 } from "@/shared/ids/uuidv7";

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
  // Runs the full manifest: canonical writers record membership provenance
  // (created_by/updated_at, migration 009), so 008-scoped runs can no longer
  // insert through the repository. The two NULL-role "never authority" cases
  // below run on isolated 008 databases with fully raw-SQL setups.
  await runMigrations(pool, migrations);
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

async function seedUser(name: string, tag: string): Promise<UserIdentity> {
  const identity: UserIdentity = { id: uuidv7(), emp_id: `P3TEAM-${tag}-${uuidv7().slice(0, 8)}`, name, org_code: "RD" };
  await db().query("INSERT INTO users (id, emp_id, name, org_code) VALUES (?, ?, ?, ?)", [
    identity.id,
    identity.emp_id,
    identity.name,
    identity.org_code,
  ]);
  return identity;
}

function callerFor(identity: UserIdentity, platformCapabilities: readonly ("workspace.create_team")[] = []): CallerContext {
  return { identity: { ...identity }, validatedExternalGroupIds: [], platformCapabilities: [...platformCapabilities] };
}

function service(): TeamWorkspaceService {
  return new TeamWorkspaceService(new MariaDbUnitOfWork(db()));
}

function governance(): TeamGovernanceService {
  return new TeamGovernanceService(new MariaDbUnitOfWork(db()));
}

async function createTeam(name: string, tag: string): Promise<{ workspaceId: string; owner: UserIdentity }> {
  const owner = await seedUser("Governance Owner", tag);
  const workspace = await service().createTeamWorkspace(callerFor(owner, ["workspace.create_team"]), { name });
  return { workspaceId: workspace.id, owner };
}

async function groupRole(workspaceId: string, externalGroupId: string): Promise<string | null | undefined> {
  const rows = await db().query<{ role: string | null }[]>(
    "SELECT role FROM workspace_group_mappings WHERE workspace_id = ? AND external_group_id = ?",
    [workspaceId, Buffer.from(externalGroupId, "utf8")],
  );
  if (rows.length === 0) return undefined;
  return rows[0].role;
}

async function directRole(workspaceId: string, userId: string): Promise<string | null | undefined> {
  const rows = await db().query<{ role: string | null }[]>(
    "SELECT role FROM workspace_memberships WHERE workspace_id = ? AND user_id = ?",
    [workspaceId, userId],
  );
  if (rows.length === 0) return undefined;
  return rows[0].role;
}

async function lifecycleOf(workspaceId: string): Promise<string | null> {
  const rows = await db().query<{ lifecycle_state: string | null }[]>("SELECT lifecycle_state FROM workspaces WHERE id = ?", [
    workspaceId,
  ]);
  return rows[0]?.lifecycle_state ?? null;
}

describe("Phase 3 Team workspace lifecycle (Task 8)", () => {
  it("1. create requires platform workspace.create_team and grants creator direct OWNER", async () => {
    const creator = await seedUser("Team Creator", "CREATE");
    await expect(service().createTeamWorkspace(callerFor(creator), { name: "Alpha Team" })).rejects.toThrow(
      TeamCreationDeniedError,
    );

    const workspace = await service().createTeamWorkspace(callerFor(creator, ["workspace.create_team"]), {
      name: "Alpha Team",
    });
    expect(workspace.workspaceType).toBe("TEAM");
    expect(workspace.lifecycleState).toBe("ACTIVE");
    expect(workspace.personalOwnerUserId).toBeNull();

    expect(await directRole(workspace.id, creator.id)).toBe("OWNER");
    const source = await db().query<{ membership_source: string | null }[]>(
      "SELECT membership_source FROM workspace_memberships WHERE workspace_id = ? AND user_id = ?",
      [workspace.id, creator.id],
    );
    expect(source[0]?.membership_source).toBe("DIRECT");
  });

  it("2. create accepts optional group mappings but never OWNER via group", async () => {
    const creator = await seedUser("Group Creator", "GRP");
    const workspace = await service().createTeamWorkspace(callerFor(creator, ["workspace.create_team"]), {
      name: "Grouped Team",
      groupMappings: [{ externalGroupId: "sso-group-1", role: "EDITOR" }],
    });
    const mappings = await db().query<{ external_group_id: unknown; role: string }[]>(
      "SELECT external_group_id, role FROM workspace_group_mappings WHERE workspace_id = ?",
      [workspace.id],
    );
    expect(mappings).toHaveLength(1);
    expect({ external_group_id: String(mappings[0].external_group_id), role: mappings[0].role }).toMatchObject({
      external_group_id: "sso-group-1",
      role: "EDITOR",
    });

    await expect(
      service().createTeamWorkspace(callerFor(creator, ["workspace.create_team"]), {
        name: "Bad Group Team",
        groupMappings: [{ externalGroupId: "sso-group-2", role: "OWNER" }],
      }),
    ).rejects.toThrow(/OWNER/i);
  });

  it("3. rename requires direct OWNER on an ACTIVE team; VIEWER rows are never authority", async () => {
    const owner = await seedUser("Rename Owner", "REN-OWN");
    const viewer = await seedUser("Rename Viewer", "REN-VIEW");
    const workspace = await service().createTeamWorkspace(callerFor(owner, ["workspace.create_team"]), {
      name: "Rename Me",
    });
    const now = new Date();
    await new MariaDbUnitOfWork(db()).run(async (repositories) => {
      await repositories.workspaceMemberships.insert(
        createDirectMembership({ workspaceId: workspace.id, userId: viewer.id, role: "VIEWER", now }),
      );
    });

    await expect(service().renameTeamWorkspace(callerFor(viewer), workspace.id, "Nope")).rejects.toThrow(
      WorkspaceAccessDeniedError,
    );

    const renamed = await service().renameTeamWorkspace(callerFor(owner), workspace.id, "Renamed Team");
    expect(renamed.name).toBe("Renamed Team");
  });

  it("3b. NULL-role rows are never rename authority (isolated 008 database)", async () => {
    const legacyHandle = await provisionIsolatedDatabase("test");
    const previous = process.env.KM_TEST_DB_NAME;
    process.env.KM_TEST_DB_NAME = legacyHandle.databaseName;
    let legacyPool: Pool | undefined;
    try {
      legacyPool = createDatabasePool(databaseConfig("test"));
      await runMigrations(legacyPool, migrations, { to: 8 });
      const ownerId = uuidv7();
      const nullRoleId = uuidv7();
      const workspaceId = uuidv7();
      const now = new Date();
      await legacyPool.query("INSERT INTO users (id, emp_id, name, org_code) VALUES (?, ?, 'Null Rename Owner', 'RD'), (?, ?, 'Null Rename User', 'RD')", [
        ownerId, `P3TEAM-RENNULL-OWN-${ownerId.slice(0, 8)}`, nullRoleId, `P3TEAM-RENNULL-NULL-${nullRoleId.slice(0, 8)}`,
      ]);
      await legacyPool.query("INSERT INTO workspaces (id, name, workspace_type) VALUES (?, 'Null Rename Team', 'TEAM')", [workspaceId]);
      await legacyPool.query(
        "INSERT INTO workspace_memberships (workspace_id, user_id, role, membership_source, created_at) VALUES (?, ?, 'OWNER', 'DIRECT', ?), (?, ?, NULL, 'DIRECT', ?)",
        [workspaceId, ownerId, now, workspaceId, nullRoleId, now],
      );
      const legacyService = new TeamWorkspaceService(new MariaDbUnitOfWork(legacyPool));
      const nullCaller: CallerContext = { identity: { id: nullRoleId, emp_id: "null", name: "Null Rename User", org_code: "RD" }, validatedExternalGroupIds: [], platformCapabilities: [] };
      const ownerCaller: CallerContext = { identity: { id: ownerId, emp_id: "owner", name: "Null Rename Owner", org_code: "RD" }, validatedExternalGroupIds: [], platformCapabilities: [] };
      await expect(legacyService.renameTeamWorkspace(nullCaller, workspaceId, "Nope")).rejects.toThrow(
        WorkspaceAccessDeniedError,
      );
      const renamed = await legacyService.renameTeamWorkspace(ownerCaller, workspaceId, "Renamed Team");
      expect(renamed.name).toBe("Renamed Team");
    } finally {
      if (previous === undefined) delete process.env.KM_TEST_DB_NAME;
      else process.env.KM_TEST_DB_NAME = previous;
      if (legacyPool) await legacyPool.end();
      await disposeIsolatedDatabase(legacyHandle);
    }
  });

  it("4. archive/restore are OWNER-only ACTIVE<->ARCHIVED transitions under row lock", async () => {
    const owner = await seedUser("Archive Owner", "ARC-OWN");
    const editor = await seedUser("Archive Editor", "ARC-ED");
    const workspace = await service().createTeamWorkspace(callerFor(owner, ["workspace.create_team"]), {
      name: "Archive Me",
    });
    const now = new Date();
    await new MariaDbUnitOfWork(db()).run(async (repositories) => {
      await repositories.workspaceMemberships.insert(
        createDirectMembership({ workspaceId: workspace.id, userId: editor.id, role: "EDITOR", now }),
      );
    });

    await expect(service().archiveTeamWorkspace(callerFor(editor), workspace.id)).rejects.toThrow(
      WorkspaceAccessDeniedError,
    );
    await expect(service().restoreTeamWorkspace(callerFor(owner), workspace.id)).rejects.toThrow(WorkspaceLifecycleError);

    const archived = await service().archiveTeamWorkspace(callerFor(owner), workspace.id);
    expect(archived.lifecycleState).toBe("ARCHIVED");
    expect(await lifecycleOf(workspace.id)).toBe("ARCHIVED");
    await expect(service().archiveTeamWorkspace(callerFor(owner), workspace.id)).rejects.toThrow(WorkspaceLifecycleError);

    const restored = await service().restoreTeamWorkspace(callerFor(owner), workspace.id);
    expect(restored.lifecycleState).toBe("ACTIVE");
    expect(await lifecycleOf(workspace.id)).toBe("ACTIVE");
  });

  it("5. archived team allows authorized read but blocks every mutation kind", async () => {
    const owner = await seedUser("Frozen Team Owner", "FRZ-OWN");
    const workspace = await service().createTeamWorkspace(callerFor(owner, ["workspace.create_team"]), {
      name: "Freeze Team",
    });
    await service().archiveTeamWorkspace(callerFor(owner), workspace.id);

    const capabilities = await new MariaDbUnitOfWork(db()).run(async (repositories) => {
      const { WorkspaceMembershipPolicy } = await import("@/modules/workspaces/application/workspace-query-service");
      const policy = new WorkspaceMembershipPolicy(repositories.workspaceMemberships, repositories.groupMappings);
      return policy.evaluateCapabilities(callerFor(owner), workspace.id);
    });
    expect(capabilities.has("workspace.discover")).toBe(true);
    expect(capabilities.has("document.read")).toBe(true);

    const locked = await new MariaDbUnitOfWork(db()).run((repositories) => repositories.workspaces.lockById(workspace.id));
    for (const operation of ["rename", "content-write", "source-import", "add-member", "add-group-mapping"] as const) {
      expect(() => assertTeamMutationAllowed(locked!, operation)).toThrow(WorkspaceLifecycleError);
    }
    await expect(service().renameTeamWorkspace(callerFor(owner), workspace.id, "Nope")).rejects.toThrow(
      WorkspaceLifecycleError,
    );
  });

  it("6. personal workspaces stay frozen: rename/archive/restore reject with PersonalWorkspaceFrozenError", async () => {
    const user = await seedUser("Personal Owner", "PERS");
    const now = new Date();
    const personalId = uuidv7();
    await new MariaDbUnitOfWork(db()).run(async (repositories) => {
      await repositories.users.upsertIdentity(user);
      await repositories.workspaces.insert(
        createPersonalWorkspaceInsert({ id: personalId, name: "My Space", ownerUserId: user.id, now }),
      );
      const { createSystemPersonalMembership } = await import("@/modules/workspaces/domain/workspace-membership");
      await repositories.workspaceMemberships.insert(
        createSystemPersonalMembership({ workspaceId: personalId, userId: user.id, now }),
      );
    });

    await expect(service().renameTeamWorkspace(callerFor(user), personalId, "Nope")).rejects.toThrow(
      PersonalWorkspaceFrozenError,
    );
    await expect(service().archiveTeamWorkspace(callerFor(user), personalId)).rejects.toThrow(
      PersonalWorkspaceFrozenError,
    );
    await expect(service().restoreTeamWorkspace(callerFor(user), personalId)).rejects.toThrow(
      PersonalWorkspaceFrozenError,
    );
  });

  it("7. unknown workspace ids surface not-found on every lifecycle mutation", async () => {
    const owner = await seedUser("Lost Owner", "LOST");
    const missing = uuidv7();
    await expect(service().renameTeamWorkspace(callerFor(owner), missing, "Nope")).rejects.toThrow(
      WorkspaceNotFoundError,
    );
    await expect(service().archiveTeamWorkspace(callerFor(owner), missing)).rejects.toThrow(WorkspaceNotFoundError);
    await expect(service().restoreTeamWorkspace(callerFor(owner), missing)).rejects.toThrow(WorkspaceNotFoundError);
  });

  it("8. team fixture helper still inserts TEAM ACTIVE rows for downstream suites", async () => {
    const owner = await seedUser("Fixture Owner", "FIX");
    const teamId = uuidv7();
    const now = new Date();
    await new MariaDbUnitOfWork(db()).run(async (repositories) => {
      await repositories.users.upsertIdentity(owner);
      await repositories.workspaces.insert(
        createTeamWorkspaceInsert({ id: teamId, name: "Fixture Team", createdBy: owner.id, now }),
      );
      await repositories.workspaceMemberships.insert(
        createDirectMembership({ workspaceId: teamId, userId: owner.id, role: "OWNER", now }),
      );
    });
    expect(await lifecycleOf(teamId)).toBe("ACTIVE");
    expect(await directRole(teamId, owner.id)).toBe("OWNER");
  });
});

describe("Phase 3 Team member and group governance (Task 9)", () => {
  it("1. OWNER runs the full direct grant flow: add, change, remove", async () => {
    const { workspaceId, owner } = await createTeam("Governed Team", "GOV-OWN");
    const editor = await seedUser("Governed Editor", "GOV-ED");
    const viewer = await seedUser("Governed Viewer", "GOV-VIEW");

    await governance().addDirectMember(callerFor(owner), workspaceId, { userId: editor.id, role: "EDITOR" });
    expect(await directRole(workspaceId, editor.id)).toBe("EDITOR");
    await governance().addDirectMember(callerFor(owner), workspaceId, { userId: viewer.id, role: "VIEWER" });
    expect(await directRole(workspaceId, viewer.id)).toBe("VIEWER");

    await governance().changeDirectMemberRole(callerFor(owner), workspaceId, { userId: editor.id, role: "VIEWER" });
    expect(await directRole(workspaceId, editor.id)).toBe("VIEWER");

    await governance().removeDirectMember(callerFor(owner), workspaceId, editor.id);
    expect(await directRole(workspaceId, editor.id)).toBeUndefined();
    expect(await directRole(workspaceId, owner.id)).toBe("OWNER");
  });

  it("2. OWNER runs the full group mapping flow: add, change, remove", async () => {
    const { workspaceId, owner } = await createTeam("Grouped Governance", "GOV-GRP");

    await governance().addGroupMapping(callerFor(owner), workspaceId, { externalGroupId: "sso-gov-1", role: "ADMIN" });
    expect(await groupRole(workspaceId, "sso-gov-1")).toBe("ADMIN");

    await governance().changeGroupMappingRole(callerFor(owner), workspaceId, {
      externalGroupId: "sso-gov-1",
      role: "EDITOR",
    });
    expect(await groupRole(workspaceId, "sso-gov-1")).toBe("EDITOR");

    await governance().removeGroupMapping(callerFor(owner), workspaceId, "sso-gov-1");
    expect(await groupRole(workspaceId, "sso-gov-1")).toBeUndefined();
  });

  it("3. ADMIN manages EDITOR/VIEWER but is denied on every OWNER/ADMIN touch", async () => {
    const { workspaceId, owner } = await createTeam("Ceiling Team", "GOV-CEIL");
    const admin = await seedUser("Ceiling Admin", "GOV-ADMIN");
    const target = await seedUser("Ceiling Target", "GOV-TGT");
    await governance().addDirectMember(callerFor(owner), workspaceId, { userId: admin.id, role: "ADMIN" });

    await governance().addDirectMember(callerFor(admin), workspaceId, { userId: target.id, role: "EDITOR" });
    expect(await directRole(workspaceId, target.id)).toBe("EDITOR");
    await governance().changeDirectMemberRole(callerFor(admin), workspaceId, { userId: target.id, role: "VIEWER" });
    expect(await directRole(workspaceId, target.id)).toBe("VIEWER");
    await governance().removeDirectMember(callerFor(admin), workspaceId, target.id);
    expect(await directRole(workspaceId, target.id)).toBeUndefined();

    const other = await seedUser("Ceiling Other", "GOV-OTH");
    await expect(
      governance().addDirectMember(callerFor(admin), workspaceId, { userId: other.id, role: "ADMIN" }),
    ).rejects.toThrow(WorkspaceAccessDeniedError);
    await expect(
      governance().addDirectMember(callerFor(admin), workspaceId, { userId: other.id, role: "OWNER" }),
    ).rejects.toThrow(WorkspaceAccessDeniedError);
    expect(await directRole(workspaceId, other.id)).toBeUndefined();

    await governance().addDirectMember(callerFor(owner), workspaceId, { userId: other.id, role: "EDITOR" });
    await expect(
      governance().changeDirectMemberRole(callerFor(admin), workspaceId, { userId: other.id, role: "ADMIN" }),
    ).rejects.toThrow(WorkspaceAccessDeniedError);
    await expect(
      governance().removeDirectMember(callerFor(admin), workspaceId, admin.id),
    ).rejects.toThrow(WorkspaceAccessDeniedError);
    expect(await directRole(workspaceId, other.id)).toBe("EDITOR");
    expect(await directRole(workspaceId, admin.id)).toBe("ADMIN");
  });

  it("4. Group→ADMIN requires OWNER; ADMIN actor is denied before and after", async () => {
    const { workspaceId, owner } = await createTeam("Group Ceiling", "GOV-GCEIL");
    const admin = await seedUser("Group Admin", "GOV-GADMIN");
    await governance().addDirectMember(callerFor(owner), workspaceId, { userId: admin.id, role: "ADMIN" });

    await expect(
      governance().addGroupMapping(callerFor(admin), workspaceId, { externalGroupId: "sso-adm-1", role: "ADMIN" }),
    ).rejects.toThrow(WorkspaceAccessDeniedError);
    expect(await groupRole(workspaceId, "sso-adm-1")).toBeUndefined();

    await governance().addGroupMapping(callerFor(admin), workspaceId, { externalGroupId: "sso-ed-1", role: "EDITOR" });
    expect(await groupRole(workspaceId, "sso-ed-1")).toBe("EDITOR");
    await expect(
      governance().changeGroupMappingRole(callerFor(admin), workspaceId, { externalGroupId: "sso-ed-1", role: "ADMIN" }),
    ).rejects.toThrow(WorkspaceAccessDeniedError);

    await governance().addGroupMapping(callerFor(owner), workspaceId, { externalGroupId: "sso-adm-2", role: "ADMIN" });
    await expect(
      governance().changeGroupMappingRole(callerFor(admin), workspaceId, {
        externalGroupId: "sso-adm-2",
        role: "EDITOR",
      }),
    ).rejects.toThrow(WorkspaceAccessDeniedError);
    await expect(
      governance().removeGroupMapping(callerFor(admin), workspaceId, "sso-adm-2"),
    ).rejects.toThrow(WorkspaceAccessDeniedError);
    expect(await groupRole(workspaceId, "sso-adm-2")).toBe("ADMIN");

    await expect(
      governance().addGroupMapping(callerFor(owner), workspaceId, { externalGroupId: "sso-bad", role: "OWNER" }),
    ).rejects.toThrow(/never grant OWNER/i);
  });

  it("5. the final direct OWNER is never removed or demoted", async () => {
    const { workspaceId, owner } = await createTeam("Last Owner", "GOV-LAST");

    await expect(
      governance().changeDirectMemberRole(callerFor(owner), workspaceId, { userId: owner.id, role: "EDITOR" }),
    ).rejects.toThrow(WorkspaceAccessDeniedError);
    await expect(governance().removeDirectMember(callerFor(owner), workspaceId, owner.id)).rejects.toThrow(
      WorkspaceAccessDeniedError,
    );
    expect(await directRole(workspaceId, owner.id)).toBe("OWNER");

    const successor = await seedUser("Second Owner", "GOV-2ND");
    await governance().addDirectMember(callerFor(owner), workspaceId, { userId: successor.id, role: "OWNER" });
    await governance().changeDirectMemberRole(callerFor(owner), workspaceId, { userId: owner.id, role: "EDITOR" });
    expect(await directRole(workspaceId, owner.id)).toBe("EDITOR");
    expect(await directRole(workspaceId, successor.id)).toBe("OWNER");
    await governance().removeDirectMember(callerFor(successor), workspaceId, owner.id);
    expect(await directRole(workspaceId, owner.id)).toBeUndefined();
  });

  it("6. non-managers are never governance authority", async () => {
    const { workspaceId, owner } = await createTeam("Authority Team", "GOV-AUTH");
    const viewer = await seedUser("Authority Viewer", "GOV-VIEW");
    const target = await seedUser("Authority Target", "GOV-TGT");
    await governance().addDirectMember(callerFor(owner), workspaceId, { userId: viewer.id, role: "VIEWER" });

    await expect(
      governance().addDirectMember(callerFor(viewer), workspaceId, { userId: target.id, role: "VIEWER" }),
    ).rejects.toThrow(WorkspaceAccessDeniedError);
    await expect(
      governance().addGroupMapping(callerFor(viewer), workspaceId, { externalGroupId: "sso-x", role: "VIEWER" }),
    ).rejects.toThrow(WorkspaceAccessDeniedError);
    expect(await directRole(workspaceId, target.id)).toBeUndefined();
    expect(await groupRole(workspaceId, "sso-x")).toBeUndefined();
  });

  it("6b. NULL-role rows are never governance authority (isolated 008 database)", async () => {
    const legacyHandle = await provisionIsolatedDatabase("test");
    const previous = process.env.KM_TEST_DB_NAME;
    process.env.KM_TEST_DB_NAME = legacyHandle.databaseName;
    let legacyPool: Pool | undefined;
    try {
      legacyPool = createDatabasePool(databaseConfig("test"));
      await runMigrations(legacyPool, migrations, { to: 8 });
      const ownerId = uuidv7();
      const outsiderId = uuidv7();
      const targetId = uuidv7();
      const workspaceId = uuidv7();
      const now = new Date();
      await legacyPool.query("INSERT INTO users (id, emp_id, name, org_code) VALUES (?, ?, 'Null Gov Owner', 'RD'), (?, ?, 'Null Gov Outsider', 'RD'), (?, ?, 'Null Gov Target', 'RD')", [
        ownerId, `P3TEAM-GOVNULL-OWN-${ownerId.slice(0, 8)}`, outsiderId, `P3TEAM-GOVNULL-OUT-${outsiderId.slice(0, 8)}`, targetId, `P3TEAM-GOVNULL-TGT-${targetId.slice(0, 8)}`,
      ]);
      await legacyPool.query("INSERT INTO workspaces (id, name, workspace_type) VALUES (?, 'Null Authority Team', 'TEAM')", [workspaceId]);
      await legacyPool.query(
        "INSERT INTO workspace_memberships (workspace_id, user_id, role, membership_source, created_at) VALUES (?, ?, 'OWNER', 'DIRECT', ?), (?, ?, NULL, 'DIRECT', ?)",
        [workspaceId, ownerId, now, workspaceId, outsiderId, now],
      );
      const legacyGovernance = new TeamGovernanceService(new MariaDbUnitOfWork(legacyPool));
      const outsiderCaller: CallerContext = { identity: { id: outsiderId, emp_id: "outsider", name: "Null Gov Outsider", org_code: "RD" }, validatedExternalGroupIds: [], platformCapabilities: [] };
      await expect(
        legacyGovernance.addDirectMember(outsiderCaller, workspaceId, { userId: targetId, role: "VIEWER" }),
      ).rejects.toThrow(WorkspaceAccessDeniedError);
      const leftovers = await legacyPool.query<unknown[]>(
        "SELECT user_id FROM workspace_memberships WHERE workspace_id = ? AND user_id = ?",
        [workspaceId, targetId],
      );
      expect(leftovers).toHaveLength(0);
    } finally {
      if (previous === undefined) delete process.env.KM_TEST_DB_NAME;
      else process.env.KM_TEST_DB_NAME = previous;
      if (legacyPool) await legacyPool.end();
      await disposeIsolatedDatabase(legacyHandle);
    }
  });

  it("7. ARCHIVED teams reject every ordinary governance mutation", async () => {
    const { workspaceId, owner } = await createTeam("Archived Governance", "GOV-ARC");
    const member = await seedUser("Archived Member", "GOV-AMEM");
    await governance().addDirectMember(callerFor(owner), workspaceId, { userId: member.id, role: "EDITOR" });
    await governance().addGroupMapping(callerFor(owner), workspaceId, { externalGroupId: "sso-arc", role: "VIEWER" });
    await service().archiveTeamWorkspace(callerFor(owner), workspaceId);

    const newcomer = await seedUser("Archived Newcomer", "GOV-ANEW");
    await expect(
      governance().addDirectMember(callerFor(owner), workspaceId, { userId: newcomer.id, role: "VIEWER" }),
    ).rejects.toThrow(WorkspaceLifecycleError);
    await expect(
      governance().changeDirectMemberRole(callerFor(owner), workspaceId, { userId: member.id, role: "VIEWER" }),
    ).rejects.toThrow(WorkspaceLifecycleError);
    await expect(governance().removeDirectMember(callerFor(owner), workspaceId, member.id)).rejects.toThrow(
      WorkspaceLifecycleError,
    );
    await expect(
      governance().addGroupMapping(callerFor(owner), workspaceId, { externalGroupId: "sso-arc-2", role: "VIEWER" }),
    ).rejects.toThrow(WorkspaceLifecycleError);
    await expect(
      governance().changeGroupMappingRole(callerFor(owner), workspaceId, {
        externalGroupId: "sso-arc",
        role: "EDITOR",
      }),
    ).rejects.toThrow(WorkspaceLifecycleError);
    await expect(governance().removeGroupMapping(callerFor(owner), workspaceId, "sso-arc")).rejects.toThrow(
      WorkspaceLifecycleError,
    );
    expect(await directRole(workspaceId, member.id)).toBe("EDITOR");
    expect(await groupRole(workspaceId, "sso-arc")).toBe("VIEWER");
  });

  it("8. personal workspaces stay frozen for governance mutations", async () => {
    const user = await seedUser("Personal Governed", "GOV-PERS");
    const newcomer = await seedUser("Personal Newcomer", "GOV-PNEW");
    const now = new Date();
    const personalId = uuidv7();
    await new MariaDbUnitOfWork(db()).run(async (repositories) => {
      await repositories.users.upsertIdentity(user);
      await repositories.workspaces.insert(
        createPersonalWorkspaceInsert({ id: personalId, name: "My Space", ownerUserId: user.id, now }),
      );
      const { createSystemPersonalMembership } = await import("@/modules/workspaces/domain/workspace-membership");
      await repositories.workspaceMemberships.insert(
        createSystemPersonalMembership({ workspaceId: personalId, userId: user.id, now }),
      );
    });

    await expect(
      governance().addDirectMember(callerFor(user), personalId, { userId: newcomer.id, role: "VIEWER" }),
    ).rejects.toThrow(PersonalWorkspaceFrozenError);
    await expect(
      governance().addGroupMapping(callerFor(user), personalId, { externalGroupId: "sso-p", role: "VIEWER" }),
    ).rejects.toThrow(PersonalWorkspaceFrozenError);
  });

  it("9. unknown workspace ids surface not-found on governance mutations and audit reads", async () => {
    const { owner } = await createTeam("Lost Governance", "GOV-LOST");
    const missing = uuidv7();
    const target = await seedUser("Lost Target", "GOV-LTGT");
    await expect(
      governance().addDirectMember(callerFor(owner), missing, { userId: target.id, role: "VIEWER" }),
    ).rejects.toThrow(WorkspaceNotFoundError);
    await expect(governance().removeDirectMember(callerFor(owner), missing, target.id)).rejects.toThrow(
      WorkspaceNotFoundError,
    );
    await expect(
      governance().addGroupMapping(callerFor(owner), missing, { externalGroupId: "sso-lost", role: "VIEWER" }),
    ).rejects.toThrow(WorkspaceNotFoundError);
    await expect(governance().listGovernanceAudit(callerFor(owner), missing)).rejects.toThrow(WorkspaceNotFoundError);
  });

  it("10. audit reads require direct OWNER or ADMIN", async () => {
    const { workspaceId, owner } = await createTeam("Audit Gate", "GOV-AGATE");
    const admin = await seedUser("Audit Admin", "GOV-AADMIN");
    const viewer = await seedUser("Audit Viewer", "GOV-AVIEW");
    const outsider = await seedUser("Audit Outsider", "GOV-AOUT");
    await governance().addDirectMember(callerFor(owner), workspaceId, { userId: admin.id, role: "ADMIN" });
    await governance().addDirectMember(callerFor(owner), workspaceId, { userId: viewer.id, role: "VIEWER" });

    const ownerEvents = await governance().listGovernanceAudit(callerFor(owner), workspaceId);
    expect(ownerEvents.length).toBeGreaterThan(0);
    const adminEvents = await governance().listGovernanceAudit(callerFor(admin), workspaceId);
    expect(adminEvents.length).toBe(ownerEvents.length);

    await expect(governance().listGovernanceAudit(callerFor(viewer), workspaceId)).rejects.toThrow(
      WorkspaceAccessDeniedError,
    );
    await expect(governance().listGovernanceAudit(callerFor(outsider), workspaceId)).rejects.toThrow(
      WorkspaceAccessDeniedError,
    );

    await service().archiveTeamWorkspace(callerFor(owner), workspaceId);
    const archivedEvents = await governance().listGovernanceAudit(callerFor(owner), workspaceId);
    expect(archivedEvents.length).toBeGreaterThanOrEqual(ownerEvents.length);
  });
});

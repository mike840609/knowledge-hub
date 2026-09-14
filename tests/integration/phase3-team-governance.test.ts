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

  it("3. rename requires direct OWNER on an ACTIVE team; NULL-role rows are never authority", async () => {
    const owner = await seedUser("Rename Owner", "REN-OWN");
    const viewer = await seedUser("Rename Viewer", "REN-VIEW");
    const nullRoleUser = await seedUser("Null Role", "REN-NULL");
    const workspace = await service().createTeamWorkspace(callerFor(owner, ["workspace.create_team"]), {
      name: "Rename Me",
    });
    const now = new Date();
    await new MariaDbUnitOfWork(db()).run(async (repositories) => {
      await repositories.workspaceMemberships.insert(
        createDirectMembership({ workspaceId: workspace.id, userId: viewer.id, role: "VIEWER", now }),
      );
    });
    await db().query(
      "INSERT INTO workspace_memberships (workspace_id, user_id, role, membership_source, created_at) VALUES (?, ?, NULL, 'DIRECT', ?)",
      [workspace.id, nullRoleUser.id, now],
    );

    await expect(service().renameTeamWorkspace(callerFor(viewer), workspace.id, "Nope")).rejects.toThrow(
      WorkspaceAccessDeniedError,
    );
    await expect(service().renameTeamWorkspace(callerFor(nullRoleUser), workspace.id, "Nope")).rejects.toThrow(
      WorkspaceAccessDeniedError,
    );

    const renamed = await service().renameTeamWorkspace(callerFor(owner), workspace.id, "Renamed Team");
    expect(renamed.name).toBe("Renamed Team");
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

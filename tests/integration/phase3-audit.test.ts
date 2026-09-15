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
import { TeamWorkspaceService } from "@/modules/workspaces/application/team-workspace-service";
import { TeamGovernanceService } from "@/modules/workspaces/application/team-governance-service";
import {
  grantTeamWorkspaceOwner,
  restoreTeamWorkspaceGovernance,
} from "../../scripts/admin/recover-team-workspace-governance";
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
  const identity: UserIdentity = { id: uuidv7(), emp_id: `P3AUD-${tag}-${uuidv7().slice(0, 8)}`, name, org_code: "RD" };
  await db().query("INSERT INTO users (id, emp_id, name, org_code) VALUES (?, ?, ?, ?)", [
    identity.id,
    identity.emp_id,
    identity.name,
    identity.org_code,
  ]);
  return identity;
}

function callerFor(identity: UserIdentity): CallerContext {
  return { identity: { ...identity }, validatedExternalGroupIds: [], platformCapabilities: ["workspace.create_team"] };
}

async function eventTypes(workspaceId: string): Promise<string[]> {
  const events = await new MariaDbUnitOfWork(db()).run((repositories) => repositories.auditEvents.listByWorkspace(workspaceId));
  return events.map((event) => event.eventType);
}

describe("Phase 3 Team lifecycle audit trail (Task 8)", () => {
  it("1. create/rename/archive/restore append their audit events in the same transaction", async () => {
    const owner = await seedUser("Audit Owner", "OWN");
    const service = new TeamWorkspaceService(new MariaDbUnitOfWork(db()));

    const workspace = await service.createTeamWorkspace(callerFor(owner), { name: "Audited Team" });
    expect(await eventTypes(workspace.id)).toEqual(["TEAM_WORKSPACE_CREATED"]);

    await service.renameTeamWorkspace(callerFor(owner), workspace.id, "Audited Team v2");
    await service.archiveTeamWorkspace(callerFor(owner), workspace.id);
    await service.restoreTeamWorkspace(callerFor(owner), workspace.id);
    expect(await eventTypes(workspace.id)).toEqual([
      "TEAM_WORKSPACE_CREATED",
      "TEAM_WORKSPACE_RENAMED",
      "TEAM_WORKSPACE_ARCHIVED",
      "TEAM_WORKSPACE_RESTORED",
    ]);
  });

  it("2. system recovery audits every action: restore and grant-owner", async () => {
    const owner = await seedUser("Recovery Owner", "REC-OWN");
    const successor = await seedUser("Recovery Successor", "REC-SUC");
    const service = new TeamWorkspaceService(new MariaDbUnitOfWork(db()));

    const workspace = await service.createTeamWorkspace(callerFor(owner), { name: "Stranded Team" });
    await service.archiveTeamWorkspace(callerFor(owner), workspace.id);
    await db().query("DELETE FROM workspace_memberships WHERE workspace_id = ? AND user_id = ?", [
      workspace.id,
      owner.id,
    ]);

    await restoreTeamWorkspaceGovernance(db(), { workspaceId: workspace.id, reason: "operator restore test" });
    await grantTeamWorkspaceOwner(db(), { workspaceId: workspace.id, userId: successor.id, reason: "grant test" });

    expect(await eventTypes(workspace.id)).toEqual([
      "TEAM_WORKSPACE_CREATED",
      "TEAM_WORKSPACE_ARCHIVED",
      "GOVERNANCE_RECOVERED",
      "GOVERNANCE_RECOVERED",
    ]);

    const rows = await db().query<{ role: string; membership_source: string }[]>(
      "SELECT role, membership_source FROM workspace_memberships WHERE workspace_id = ? AND user_id = ?",
      [workspace.id, successor.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ role: "OWNER", membership_source: "DIRECT" });
  });

  it("3. recovery refuses to grant a non-existent Hub user and audits nothing", async () => {
    const owner = await seedUser("Refuse Owner", "REF");
    const service = new TeamWorkspaceService(new MariaDbUnitOfWork(db()));
    const workspace = await service.createTeamWorkspace(callerFor(owner), { name: "Refuse Team" });

    await expect(
      grantTeamWorkspaceOwner(db(), { workspaceId: workspace.id, userId: uuidv7(), reason: "ghost grant" }),
    ).rejects.toThrow(/existing Hub user/i);
    expect(await eventTypes(workspace.id)).toEqual(["TEAM_WORKSPACE_CREATED"]);
  });
});

describe("Phase 3 governance audit trail (Task 9)", () => {
  it("4. direct and group governance mutations append their §16 events in the same transaction", async () => {
    const owner = await seedUser("Governance Auditor", "GOV-AUD");
    const member = await seedUser("Governed Auditee", "GOV-AUDEE");
    const lifecycle = new TeamWorkspaceService(new MariaDbUnitOfWork(db()));
    const governance = new TeamGovernanceService(new MariaDbUnitOfWork(db()));

    const workspace = await lifecycle.createTeamWorkspace(callerFor(owner), { name: "Governed Audit Team" });
    await governance.addDirectMember(callerFor(owner), workspace.id, { userId: member.id, role: "EDITOR" });
    await governance.changeDirectMemberRole(callerFor(owner), workspace.id, { userId: member.id, role: "VIEWER" });
    await governance.addGroupMapping(callerFor(owner), workspace.id, { externalGroupId: "sso-audit", role: "EDITOR" });
    await governance.changeGroupMappingRole(callerFor(owner), workspace.id, {
      externalGroupId: "sso-audit",
      role: "VIEWER",
    });
    await governance.removeGroupMapping(callerFor(owner), workspace.id, "sso-audit");
    await governance.removeDirectMember(callerFor(owner), workspace.id, member.id);

    expect(await eventTypes(workspace.id)).toEqual([
      "TEAM_WORKSPACE_CREATED",
      "MEMBER_ADDED",
      "ROLE_CHANGED",
      "GROUP_MAPPING_ADDED",
      "GROUP_MAPPING_ROLE_CHANGED",
      "GROUP_MAPPING_REMOVED",
      "REMOVED",
    ]);
  });

  it("5. denied governance mutations audit nothing", async () => {
    const owner = await seedUser("Silent Owner", "SIL-OWN");
    const stranger = await seedUser("Silent Stranger", "SIL-STR");
    const target = await seedUser("Silent Target", "SIL-TGT");
    const lifecycle = new TeamWorkspaceService(new MariaDbUnitOfWork(db()));
    const governance = new TeamGovernanceService(new MariaDbUnitOfWork(db()));

    const workspace = await lifecycle.createTeamWorkspace(callerFor(owner), { name: "Silent Team" });
    await expect(
      governance.addDirectMember(callerFor(stranger), workspace.id, { userId: target.id, role: "VIEWER" }),
    ).rejects.toThrow();
    await expect(
      governance.removeDirectMember(callerFor(owner), workspace.id, owner.id),
    ).rejects.toThrow();
    expect(await eventTypes(workspace.id)).toEqual(["TEAM_WORKSPACE_CREATED"]);
  });
});

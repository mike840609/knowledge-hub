import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { createTeamWorkspaceInsert } from "@/modules/workspaces/domain/workspace";
import { createDirectMembership } from "@/modules/workspaces/domain/workspace-membership";
import type { UserIdentity } from "@/modules/identity/domain/user-identity";
import { uuidv7 } from "@/shared/ids/uuidv7";
import { disposeIsolatedDatabase, provisionIsolatedDatabase } from "../../scripts/db/test-database";
import { runMigrations, type IsolatedDatabaseHandle } from "../../scripts/db/migrate";

const owner: UserIdentity = { id: "0199f300-0000-7000-8000-000000000001", emp_id: "P3-LOCK", name: "Lock Owner", org_code: "P3" };
const editor: UserIdentity = { id: "0199f300-0000-7000-8000-000000000002", emp_id: "P3-LOCK-ED", name: "Lock Editor", org_code: "P3" };

let handle: IsolatedDatabaseHandle;
let pool: Pool;
let poolB: Pool;

async function openPool(): Promise<Pool> {
  const previous = process.env.KM_TEST_DB_NAME;
  process.env.KM_TEST_DB_NAME = handle.databaseName;
  try {
    return createDatabasePool(databaseConfig("test"));
  } finally {
    if (previous === undefined) delete process.env.KM_TEST_DB_NAME;
    else process.env.KM_TEST_DB_NAME = previous;
  }
}

beforeAll(async () => {
  handle = await provisionIsolatedDatabase("test");
  pool = await openPool();
  poolB = await openPool();
  await runMigrations(pool);
});

afterAll(async () => {
  await pool.end();
  await poolB.end();
  await disposeIsolatedDatabase(handle);
});

async function setupGovernanceScope(): Promise<{ workspaceId: string }> {
  const workspaceId = uuidv7();
  const now = new Date();
  await new MariaDbUnitOfWork(pool).run(async (repositories) => {
    await repositories.users.upsertIdentity(owner);
    await repositories.users.upsertIdentity(editor);
    await repositories.workspaces.insert(createTeamWorkspaceInsert({ id: workspaceId, name: "Lock Scope", createdBy: owner.id, now }));
    await repositories.workspaceMemberships.insert(createDirectMembership({ workspaceId, userId: owner.id, role: "OWNER", now }));
    await repositories.workspaceMemberships.insert(createDirectMembership({ workspaceId, userId: editor.id, role: "EDITOR", now }));
  });
  return { workspaceId };
}

describe("Phase 3 workspace governance locking and primitives (Task 5)", () => {
  it("lockById returns the workspace with governance fields inside a transaction", async () => {
    const { workspaceId } = await setupGovernanceScope();
    const locked = await new MariaDbUnitOfWork(pool).run((repositories) => repositories.workspaces.lockById(workspaceId));
    expect(locked?.id).toBe(workspaceId);
    expect(locked?.workspaceType).toBe("TEAM");
    expect(locked?.lifecycleState).toBe("ACTIVE");
  });

  it("lockById returns null for a missing workspace without locking", async () => {
    const locked = await new MariaDbUnitOfWork(pool).run((repositories) => repositories.workspaces.lockById(uuidv7()));
    expect(locked).toBeNull();
  });

  it("concurrent governance transactions serialize on the workspace lock", async () => {
    const { workspaceId } = await setupGovernanceScope();
    const first = new MariaDbUnitOfWork(pool).run(async (repositories) => {
      const locked = await repositories.workspaces.lockById(workspaceId);
      if (!locked) throw new Error("Workspace must exist for the lock serialization check.");
      await repositories.auditEvents.append({
        id: uuidv7(), workspaceId, actorUserId: owner.id, actorKind: "USER",
        eventType: "GOVERNANCE_LOCK_CHECK_A", targetType: null, targetId: null,
        payload: null, correlationId: null, createdAt: new Date(),
      });
    });
    const second = new MariaDbUnitOfWork(poolB).run(async (repositories) => {
      const locked = await repositories.workspaces.lockById(workspaceId);
      if (!locked) throw new Error("Workspace must exist for the lock serialization check.");
      await repositories.auditEvents.append({
        id: uuidv7(), workspaceId, actorUserId: editor.id, actorKind: "USER",
        eventType: "GOVERNANCE_LOCK_CHECK_B", targetType: null, targetId: null,
        payload: null, correlationId: null, createdAt: new Date(),
      });
    });
    await Promise.all([first, second]);
    const events = await new MariaDbUnitOfWork(pool).run((repositories) => repositories.auditEvents.listByWorkspace(workspaceId));
    expect(events.map((event) => event.eventType).sort()).toEqual(["GOVERNANCE_LOCK_CHECK_A", "GOVERNANCE_LOCK_CHECK_B"]);
  });

  it("directOwnerCount counts only DIRECT OWNER memberships", async () => {
    const { workspaceId } = await setupGovernanceScope();
    const count = await new MariaDbUnitOfWork(pool).run((repositories) => repositories.workspaceMemberships.countDirectOwners(workspaceId));
    expect(count).toBe(1);
  });

  it("group mapping exact lookup matches exact bytes only", async () => {
    const { workspaceId } = await setupGovernanceScope();
    const now = new Date();
    const groupId = `sso-group-exact-${uuidv7()}`;
    await new MariaDbUnitOfWork(pool).run((repositories) =>
      repositories.groupMappings.insert({
        id: uuidv7(), workspaceId, externalGroupId: groupId, role: "VIEWER", createdBy: owner.id, createdAt: now, updatedAt: now,
      }),
    );
    const exact = await new MariaDbUnitOfWork(pool).run((repositories) => repositories.groupMappings.findExact(workspaceId, groupId));
    expect(exact?.role).toBe("VIEWER");
    const nearMiss = await new MariaDbUnitOfWork(pool).run((repositories) =>
      repositories.groupMappings.findExact(workspaceId, ` ${groupId} `),
    );
    expect(nearMiss).toBeNull();
  });

  it("audit events are append-only and listable per workspace", async () => {
    const { workspaceId } = await setupGovernanceScope();
    const now = new Date();
    await new MariaDbUnitOfWork(pool).run(async (repositories) => {
      await repositories.auditEvents.append({
        id: uuidv7(), workspaceId, actorUserId: owner.id, actorKind: "USER",
        eventType: "TEAM_WORKSPACE_CREATED", targetType: null, targetId: null,
        payload: { workspaceId }, correlationId: null, createdAt: now,
      });
      await repositories.auditEvents.append({
        id: uuidv7(), workspaceId, actorUserId: null, actorKind: "SYSTEM",
        eventType: "TEAM_DIRECT_OWNER_GRANTED", targetType: "USER", targetId: editor.id,
        payload: null, correlationId: null, createdAt: now,
      });
    });
    const events = await new MariaDbUnitOfWork(pool).run((repositories) => repositories.auditEvents.listByWorkspace(workspaceId));
    expect(events.map((event) => event.eventType).sort()).toEqual(["TEAM_DIRECT_OWNER_GRANTED", "TEAM_WORKSPACE_CREATED"]);
    expect(events.every((event) => event.workspaceId === workspaceId)).toBe(true);
  });
});

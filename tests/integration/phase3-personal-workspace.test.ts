import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { migrations } from "@/infrastructure/database/mariadb/migrations";
import { runMigrations, type IsolatedDatabaseHandle } from "../../scripts/db/migrate";
import { disposeIsolatedDatabase, provisionIsolatedDatabase } from "../../scripts/db/test-database";
import { PersonalWorkspaceService, assertPersonalMutationAllowed } from "@/modules/workspaces/application/personal-workspace-service";
import { PersonalWorkspaceFrozenError } from "@/modules/workspaces/domain/errors";
import type { Workspace } from "@/modules/workspaces/domain/workspace";
import { backfillPersonalWorkspaces } from "../../scripts/db/backfill-personal-workspaces";
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

function openSecondPool(): Pool {
  if (!handle) throw new Error("Isolated test database is not provisioned.");
  const previous = process.env.KM_TEST_DB_NAME;
  process.env.KM_TEST_DB_NAME = handle.databaseName;
  try {
    return createDatabasePool(databaseConfig("test"));
  } finally {
    if (previous === undefined) delete process.env.KM_TEST_DB_NAME;
    else process.env.KM_TEST_DB_NAME = previous;
  }
}

function serviceOn(connection: Pool): PersonalWorkspaceService {
  return new PersonalWorkspaceService(new MariaDbUnitOfWork(connection));
}

async function seedUser(name: string, empTag: string): Promise<{ id: string; empId: string }> {
  const id = uuidv7();
  const empId = `P3PERS-${empTag}-${id.slice(0, 8)}`;
  await db().query("INSERT INTO users (id, emp_id, name, org_code) VALUES (?, ?, ?, 'RD')", [id, empId, name]);
  return { id, empId };
}

async function personalRowsForOwner(ownerId: string): Promise<{ id: string; name: string; workspace_type: string | null }[]> {
  const rows = await db().query<{ id: string; name: string; workspace_type: string | null }[]>(
    "SELECT id, name, workspace_type FROM workspaces WHERE personal_owner_user_id = ?",
    [ownerId],
  );
  return rows.map((row) => ({ id: String(row.id), name: String(row.name), workspace_type: row.workspace_type }));
}

async function membershipRows(workspaceId: string, userId: string): Promise<{ role: string | null; membership_source: string | null }[]> {
  const rows = await db().query<{ role: string | null; membership_source: string | null }[]>(
    "SELECT role, membership_source FROM workspace_memberships WHERE workspace_id = ? AND user_id = ?",
    [workspaceId, userId],
  );
  return rows.map((row) => ({ role: row.role, membership_source: row.membership_source }));
}

async function provisionedAuditCount(workspaceId: string): Promise<number> {
  const rows = await db().query<{ count: number }[]>(
    "SELECT COUNT(*) AS count FROM workspace_audit_events WHERE workspace_id = ? AND event_type = 'PERSONAL_WORKSPACE_PROVISIONED'",
    [workspaceId],
  );
  return Number(rows[0].count);
}

describe("Phase 3 Personal workspace provisioning (Task 7)", () => {
  it("1. repeated ensure returns the same fixed My Space with one OWNER/SYSTEM_PERSONAL membership", async () => {
    const user = await seedUser("My Space Owner", "ONCE");
    const service = serviceOn(db());

    const first = await service.ensurePersonalWorkspace(user.id);
    const second = await service.ensurePersonalWorkspace(user.id);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.workspace.id).toBe(first.workspace.id);
    expect(first.workspace.name).toBe("My Space");
    expect(first.workspace.workspaceType).toBe("PERSONAL");
    expect(first.workspace.personalOwnerUserId).toBe(user.id);
    expect(first.workspace.lifecycleState).toBe("ACTIVE");

    const rows = await personalRowsForOwner(user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(first.workspace.id);
    expect(rows[0].name).toBe("My Space");
    expect(rows[0].workspace_type).toBe("PERSONAL");

    const memberships = await membershipRows(first.workspace.id, user.id);
    expect(memberships).toHaveLength(1);
    expect(memberships[0]).toMatchObject({ role: "OWNER", membership_source: "SYSTEM_PERSONAL" });

    expect(await provisionedAuditCount(first.workspace.id)).toBe(1);
  });

  it("2. different owners get independent My Spaces", async () => {
    const first = await seedUser("First Owner", "FIRST");
    const second = await seedUser("Second Owner", "SECOND");
    const service = serviceOn(db());

    const firstWorkspace = await service.ensurePersonalWorkspace(first.id);
    const secondWorkspace = await service.ensurePersonalWorkspace(second.id);

    expect(secondWorkspace.workspace.id).not.toBe(firstWorkspace.workspace.id);
    expect((await personalRowsForOwner(first.id))).toHaveLength(1);
    expect((await personalRowsForOwner(second.id))).toHaveLength(1);
  });

  it("3. two concurrent ensures converge on one workspace via uq_workspaces_personal_owner", async () => {
    const user = await seedUser("Race Owner", "RACE");
    const poolB = openSecondPool();
    try {
      const [left, right] = await Promise.all([
        serviceOn(db()).ensurePersonalWorkspace(user.id),
        serviceOn(poolB).ensurePersonalWorkspace(user.id),
      ]);
      expect(left.workspace.id).toBe(right.workspace.id);
      expect(left.workspace.name).toBe("My Space");

      expect(await personalRowsForOwner(user.id)).toHaveLength(1);
      expect(await membershipRows(left.workspace.id, user.id)).toHaveLength(1);
      expect(await provisionedAuditCount(left.workspace.id)).toBe(1);
    } finally {
      await poolB.end();
    }
  });

  it("4. system freeze rejects every Personal mutation kind but passes Team workspaces through", async () => {
    const user = await seedUser("Frozen Owner", "FROZEN");
    const service = serviceOn(db());
    const { workspace } = await service.ensurePersonalWorkspace(user.id);

    const operations = ["rename", "add-member", "add-group-mapping", "transfer-ownership", "archive", "delete"] as const;
    for (const operation of operations) {
      expect(() => assertPersonalMutationAllowed(workspace, operation)).toThrow(PersonalWorkspaceFrozenError);
      expect(() => assertPersonalMutationAllowed(workspace, operation)).toThrow(/frozen/i);
    }

    const team: Workspace = {
      ...workspace,
      id: uuidv7(),
      name: "Team Space",
      workspaceType: "TEAM",
      personalOwnerUserId: null,
    };
    for (const operation of operations) {
      expect(() => assertPersonalMutationAllowed(team, operation)).not.toThrow();
    }
  });

  it("5. provisioning before migration 008 fails with a clear migration error and writes nothing", async () => {
    const legacyHandle = await provisionIsolatedDatabase("test");
    const previous = process.env.KM_TEST_DB_NAME;
    process.env.KM_TEST_DB_NAME = legacyHandle.databaseName;
    let legacyPool: Pool | undefined;
    try {
      legacyPool = createDatabasePool(databaseConfig("test"));
      await runMigrations(legacyPool, migrations, { to: 7 });
      const userId = uuidv7();
      await legacyPool.query("INSERT INTO users (id, emp_id, name, org_code) VALUES (?, ?, 'Legacy User', 'RD')", [
        userId,
        `P3PERS-LEGACY-${userId.slice(0, 8)}`,
      ]);
      await expect(serviceOn(legacyPool).ensurePersonalWorkspace(userId)).rejects.toThrow(/migration 008/i);
      const rows = await legacyPool.query<unknown[]>("SELECT id FROM workspaces");
      expect(rows).toHaveLength(0);
    } finally {
      if (previous === undefined) delete process.env.KM_TEST_DB_NAME;
      else process.env.KM_TEST_DB_NAME = previous;
      if (legacyPool) await legacyPool.end();
      await disposeIsolatedDatabase(legacyHandle);
    }
  });

  it("6. rerunnable backfill gives every Hub user exactly one verified My Space", async () => {
    const users = [await seedUser("Backfill One", "B1"), await seedUser("Backfill Two", "B2"), await seedUser("Backfill Three", "B3")];
    await serviceOn(db()).ensurePersonalWorkspace(users[0].id);

    const first = await backfillPersonalWorkspaces(db());
    expect(first.users).toBe(3);
    expect(first.provisioned).toBe(2);
    expect(first.alreadyProvisioned).toBe(1);

    for (const user of users) {
      const rows = await personalRowsForOwner(user.id);
      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBe("My Space");
      expect(await membershipRows(rows[0].id, user.id)).toMatchObject([{ role: "OWNER", membership_source: "SYSTEM_PERSONAL" }]);
    }

    const second = await backfillPersonalWorkspaces(db());
    expect(second).toMatchObject({ users: 3, provisioned: 0, alreadyProvisioned: 3 });
  });
});

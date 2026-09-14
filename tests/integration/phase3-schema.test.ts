import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { migrations } from "@/infrastructure/database/mariadb/migrations";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { createPersonalWorkspaceInsert, createTeamWorkspaceInsert } from "@/modules/workspaces/domain/workspace";
import type { WorkspaceInsert } from "@/modules/workspaces/domain/workspace";
import { createDirectMembership, createSystemPersonalMembership } from "@/modules/workspaces/domain/workspace-membership";
import type { WorkspaceMembershipInsert } from "@/modules/workspaces/domain/workspace-membership";
import { runMigrations, type IsolatedDatabaseHandle } from "../../scripts/db/migrate";
import { disposeIsolatedDatabase, provisionIsolatedDatabase } from "../../scripts/db/test-database";
import { uuidv7 } from "@/shared/ids/uuidv7";

let pool: Pool;

beforeAll(() => {
  pool = createDatabasePool(databaseConfig("test"));
});

afterAll(async () => {
  await pool.end();
});

async function createIsolatedPool(): Promise<{ handle: IsolatedDatabaseHandle; pool: Pool }> {
  const handle = await provisionIsolatedDatabase("test");
  const previous = process.env.KM_TEST_DB_NAME;
  process.env.KM_TEST_DB_NAME = handle.databaseName;
  try {
    return { handle, pool: createDatabasePool(databaseConfig("test")) };
  } finally {
    if (previous === undefined) delete process.env.KM_TEST_DB_NAME;
    else process.env.KM_TEST_DB_NAME = previous;
  }
}

async function disposePool(handle: IsolatedDatabaseHandle, pool: Pool): Promise<void> {
  await pool.end();
  await disposeIsolatedDatabase(handle);
}

async function seedLegacyRows(target: Pool): Promise<{ userId: string; workspaceId: string }> {
  const userId = uuidv7();
  const workspaceId = uuidv7();
  await target.query("INSERT INTO users (id, emp_id, name, org_code) VALUES (?, ?, 'Legacy User', 'LEGACY')", [userId, `legacy-${userId}`]);
  await target.query("INSERT INTO workspaces (id, name) VALUES (?, 'Legacy Workspace')", [workspaceId]);
  await target.query("INSERT INTO workspace_memberships (workspace_id, user_id) VALUES (?, ?)", [workspaceId, userId]);
  return { userId, workspaceId };
}

describe("Phase 3 additive governance schema (migration 008)", () => {
  it("migration 008 is recorded as APPLIED", async () => {
    const rows = await pool.query<{ version: number; state: string }[]>(
      "SELECT version, state FROM schema_migrations WHERE version = 8",
    );
    expect(rows.map((row) => [Number(row.version), row.state])).toEqual([[8, "APPLIED"]]);
  });

  it("existing Workspace IDs survive migration 008", async () => {
    const { handle, pool: legacyPool } = await createIsolatedPool();
    try {
      await runMigrations(legacyPool, migrations, { to: 7 });
      const { workspaceId } = await seedLegacyRows(legacyPool);
      await runMigrations(legacyPool, migrations);
      const rows = await legacyPool.query<{ id: string }[]>("SELECT id FROM workspaces WHERE id = ?", [workspaceId]);
      expect(rows.map((row) => String(row.id))).toEqual([workspaceId]);
      const members = await legacyPool.query<{ workspace_id: string }[]>(
        "SELECT workspace_id FROM workspace_memberships WHERE workspace_id = ?",
        [workspaceId],
      );
      expect(members).toHaveLength(1);
    } finally {
      await disposePool(handle, legacyPool);
    }
  });

  it("existing Workspaces are explicitly backfilled to TEAM", async () => {
    const { handle, pool: legacyPool } = await createIsolatedPool();
    try {
      await runMigrations(legacyPool, migrations, { to: 7 });
      const { workspaceId } = await seedLegacyRows(legacyPool);
      await runMigrations(legacyPool, migrations);
      const rows = await legacyPool.query<{ workspace_type: string | null }[]>(
        "SELECT workspace_type FROM workspaces WHERE id = ?",
        [workspaceId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].workspace_type).toBe("TEAM");
    } finally {
      await disposePool(handle, legacyPool);
    }
  });

  it("membership role/membership_source may remain nullable until bootstrap", async () => {
    const userId = uuidv7();
    const workspaceId = uuidv7();
    await pool.query("INSERT INTO users (id, emp_id, name, org_code) VALUES (?, ?, 'Nullable Role User', 'P3')", [userId, `p3-${userId}`]);
    await pool.query("INSERT INTO workspaces (id, name, workspace_type) VALUES (?, 'Nullable Role Workspace', 'TEAM')", [workspaceId]);
    await pool.query("INSERT INTO workspace_memberships (workspace_id, user_id, role, membership_source) VALUES (?, ?, NULL, NULL)", [workspaceId, userId]);
    const rows = await pool.query<{ role: string | null; membership_source: string | null }[]>(
      "SELECT role, membership_source FROM workspace_memberships WHERE workspace_id = ? AND user_id = ?",
      [workspaceId, userId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].role).toBeNull();
    expect(rows[0].membership_source).toBeNull();
  });

  it("personal_owner_user_id is nullable but UNIQUE already in 008", async () => {
    const constraints = await pool.query<{ CONSTRAINT_NAME: string }[]>(
      "SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'workspaces' AND CONSTRAINT_TYPE = 'UNIQUE'",
    );
    expect(constraints.map((row) => row.CONSTRAINT_NAME)).toContain("uq_workspaces_personal_owner");

    const indexes = await pool.query<{ Key_name: string; Non_unique: number; Column_name: string }[]>("SHOW INDEX FROM workspaces");
    const ownerIndex = indexes.find((row) => row.Key_name === "uq_workspaces_personal_owner");
    expect(ownerIndex).toBeDefined();
    expect(Number(ownerIndex?.Non_unique)).toBe(0);
    expect(ownerIndex?.Column_name).toBe("personal_owner_user_id");

    const workspaceId = uuidv7();
    await pool.query("INSERT INTO workspaces (id, name, workspace_type, personal_owner_user_id) VALUES (?, 'Null Owner Workspace', 'TEAM', NULL)", [workspaceId]);
    const rows = await pool.query<{ personal_owner_user_id: string | null }[]>(
      "SELECT personal_owner_user_id FROM workspaces WHERE id = ?",
      [workspaceId],
    );
    expect(rows[0].personal_owner_user_id).toBeNull();
  });

  it("duplicate non-null personal_owner_user_id is rejected", async () => {
    const ownerId = uuidv7();
    await pool.query("INSERT INTO users (id, emp_id, name, org_code) VALUES (?, ?, 'Personal Owner', 'P3')", [ownerId, `p3-${ownerId}`]);
    await pool.query("INSERT INTO workspaces (id, name, workspace_type, personal_owner_user_id) VALUES (?, 'My Space', 'PERSONAL', ?)", [uuidv7(), ownerId]);
    await expect(
      pool.query("INSERT INTO workspaces (id, name, workspace_type, personal_owner_user_id) VALUES (?, 'My Space Duplicate', 'PERSONAL', ?)", [uuidv7(), ownerId]),
    ).rejects.toThrow();
  });

  it("multiple TEAM rows with personal_owner_user_id = NULL are allowed", async () => {
    await pool.query("INSERT INTO workspaces (id, name, workspace_type, personal_owner_user_id) VALUES (?, 'Team Null A', 'TEAM', NULL)", [uuidv7()]);
    await pool.query("INSERT INTO workspaces (id, name, workspace_type, personal_owner_user_id) VALUES (?, 'Team Null B', 'TEAM', NULL)", [uuidv7()]);
    const rows = await pool.query<{ count: number }[]>(
      "SELECT COUNT(*) AS count FROM workspaces WHERE name IN ('Team Null A', 'Team Null B')",
    );
    expect(Number(rows[0].count)).toBe(2);
  });

  it("external_identity_links protects exact (provider, subject_bytes)", async () => {
    const hubUserId = uuidv7();
    await pool.query("INSERT INTO users (id, emp_id, name, org_code) VALUES (?, ?, 'Identity User', 'P3')", [hubUserId, `p3-${hubUserId}`]);
    const subject = Buffer.from("subject-exact-1", "utf8");
    await pool.query(
      "INSERT INTO external_identity_links (id, provider, subject_bytes, hub_user_id) VALUES (?, 'company-sso', ?, ?)",
      [uuidv7(), subject, hubUserId],
    );
    await expect(
      pool.query("INSERT INTO external_identity_links (id, provider, subject_bytes, hub_user_id) VALUES (?, 'company-sso', ?, ?)", [uuidv7(), subject, uuidv7()]),
    ).rejects.toThrow();

    const otherHubUserId = uuidv7();
    await pool.query("INSERT INTO users (id, emp_id, name, org_code) VALUES (?, ?, 'Identity Other', 'P3')", [otherHubUserId, `p3-${otherHubUserId}`]);
    await pool.query(
      "INSERT INTO external_identity_links (id, provider, subject_bytes, hub_user_id) VALUES (?, 'other-sso', ?, ?)",
      [uuidv7(), subject, otherHubUserId],
    );
    const rows = await pool.query<{ count: number }[]>("SELECT COUNT(*) AS count FROM external_identity_links WHERE provider = 'other-sso'");
    expect(Number(rows[0].count)).toBe(1);
  });

  it("same provider cannot silently bind two subjects to one Hub user", async () => {
    const hubUserId = uuidv7();
    await pool.query("INSERT INTO users (id, emp_id, name, org_code) VALUES (?, ?, 'Bound User', 'P3')", [hubUserId, `p3-${hubUserId}`]);
    await pool.query(
      "INSERT INTO external_identity_links (id, provider, subject_bytes, hub_user_id) VALUES (?, 'company-sso', ?, ?)",
      [uuidv7(), Buffer.from("subject-bind-1", "utf8"), hubUserId],
    );
    await expect(
      pool.query("INSERT INTO external_identity_links (id, provider, subject_bytes, hub_user_id) VALUES (?, 'company-sso', ?, ?)", [uuidv7(), Buffer.from("subject-bind-2", "utf8"), hubUserId]),
    ).rejects.toThrow();
  });

  it("group mapping cannot grant OWNER", async () => {
    const workspaceId = uuidv7();
    await pool.query("INSERT INTO workspaces (id, name, workspace_type) VALUES (?, 'Group Mapping Workspace', 'TEAM')", [workspaceId]);
    await expect(
      pool.query(
        "INSERT INTO workspace_group_mappings (id, workspace_id, external_group_id, role) VALUES (?, ?, ?, 'OWNER')",
        [uuidv7(), workspaceId, Buffer.from("sso-group-1", "utf8")],
      ),
    ).rejects.toThrow();
    await pool.query(
      "INSERT INTO workspace_group_mappings (id, workspace_id, external_group_id, role) VALUES (?, ?, ?, 'ADMIN')",
      [uuidv7(), workspaceId, Buffer.from("sso-group-1", "utf8")],
    );
    const rows = await pool.query<{ role: string }[]>("SELECT role FROM workspace_group_mappings WHERE workspace_id = ?", [workspaceId]);
    expect(rows.map((row) => row.role)).toEqual(["ADMIN"]);
  });

  it("safe FKs on new tables reject orphan rows", async () => {
    const missingUserId = uuidv7();
    await expect(
      pool.query("INSERT INTO external_identity_links (id, provider, subject_bytes, hub_user_id) VALUES (?, 'company-sso', ?, ?)", [uuidv7(), Buffer.from("orphan-subject", "utf8"), missingUserId]),
    ).rejects.toThrow();

    const missingWorkspaceId = uuidv7();
    await expect(
      pool.query("INSERT INTO workspace_group_mappings (id, workspace_id, external_group_id, role) VALUES (?, ?, ?, 'VIEWER')", [uuidv7(), missingWorkspaceId, Buffer.from("orphan-group", "utf8")]),
    ).rejects.toThrow();
    await expect(
      pool.query("INSERT INTO workspace_audit_events (id, workspace_id, actor_kind, event_type) VALUES (?, ?, 'SYSTEM', 'TEAM_WORKSPACE_CREATED')", [uuidv7(), missingWorkspaceId]),
    ).rejects.toThrow();
  });
});

describe("Phase 3 canonical writer contracts (Task 5)", () => {
  it("TEAM Workspace insert writes workspace_type=TEAM and lifecycle_state=ACTIVE", async () => {
    const workspaceId = uuidv7();
    const now = new Date();
    await new MariaDbUnitOfWork(pool).run((repositories) =>
      repositories.workspaces.insert(createTeamWorkspaceInsert({ id: workspaceId, name: "Writer Contract Team", createdBy: null, now })),
    );
    const rows = await pool.query<{ workspace_type: string | null; lifecycle_state: string | null; personal_owner_user_id: string | null }[]>(
      "SELECT workspace_type, lifecycle_state, personal_owner_user_id FROM workspaces WHERE id = ?",
      [workspaceId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].workspace_type).toBe("TEAM");
    expect(rows[0].lifecycle_state).toBe("ACTIVE");
    expect(rows[0].personal_owner_user_id).toBeNull();
  });

  it("direct membership insert always writes role + membership_source=DIRECT", async () => {
    const userId = uuidv7();
    const workspaceId = uuidv7();
    const now = new Date();
    await pool.query("INSERT INTO users (id, emp_id, name, org_code) VALUES (?, ?, 'Direct Member', 'P3')", [userId, `p3-${userId}`]);
    await new MariaDbUnitOfWork(pool).run(async (repositories) => {
      await repositories.workspaces.insert(createTeamWorkspaceInsert({ id: workspaceId, name: "Direct Membership Workspace", createdBy: userId, now }));
      await repositories.workspaceMemberships.insert(createDirectMembership({ workspaceId, userId, role: "EDITOR", now }));
    });
    const rows = await pool.query<{ role: string | null; membership_source: string | null }[]>(
      "SELECT role, membership_source FROM workspace_memberships WHERE workspace_id = ? AND user_id = ?",
      [workspaceId, userId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].role).toBe("EDITOR");
    expect(rows[0].membership_source).toBe("DIRECT");
  });

  it("personal/system insert API can write role=OWNER + membership_source=SYSTEM_PERSONAL", async () => {
    const ownerId = uuidv7();
    const workspaceId = uuidv7();
    const now = new Date();
    await pool.query("INSERT INTO users (id, emp_id, name, org_code) VALUES (?, ?, 'Personal Owner', 'P3')", [ownerId, `p3-${ownerId}`]);
    await new MariaDbUnitOfWork(pool).run(async (repositories) => {
      await repositories.workspaces.insert(createPersonalWorkspaceInsert({ id: workspaceId, name: "My Space", ownerUserId: ownerId, now }));
      await repositories.workspaceMemberships.insert(createSystemPersonalMembership({ workspaceId, userId: ownerId, now }));
    });
    const workspaces = await pool.query<{ workspace_type: string | null; personal_owner_user_id: string | null }[]>(
      "SELECT workspace_type, personal_owner_user_id FROM workspaces WHERE id = ?",
      [workspaceId],
    );
    expect(workspaces[0].workspace_type).toBe("PERSONAL");
    expect(String(workspaces[0].personal_owner_user_id)).toBe(ownerId);
    const memberships = await pool.query<{ role: string | null; membership_source: string | null }[]>(
      "SELECT role, membership_source FROM workspace_memberships WHERE workspace_id = ? AND user_id = ?",
      [workspaceId, ownerId],
    );
    expect(memberships).toHaveLength(1);
    expect(memberships[0].role).toBe("OWNER");
    expect(memberships[0].membership_source).toBe("SYSTEM_PERSONAL");
  });

  it("repository inserts reject governance-less rows that migration 009 will forbid", async () => {
    const now = new Date();
    const legacyWorkspace = { id: uuidv7(), name: "Governance-less", createdAt: now, updatedAt: now } as unknown as WorkspaceInsert;
    await expect(
      new MariaDbUnitOfWork(pool).run((repositories) => repositories.workspaces.insert(legacyWorkspace)),
    ).rejects.toThrow();
    const legacyMembership = { workspaceId: uuidv7(), userId: uuidv7(), createdAt: now } as unknown as WorkspaceMembershipInsert;
    await expect(
      new MariaDbUnitOfWork(pool).run((repositories) => repositories.workspaceMemberships.insert(legacyMembership)),
    ).rejects.toThrow();
  });

  it("legacy raw NULL rows remain possible only for controlled bootstrap tests", async () => {
    const userId = uuidv7();
    const workspaceId = uuidv7();
    await pool.query("INSERT INTO users (id, emp_id, name, org_code) VALUES (?, ?, 'Bootstrap Legacy', 'P3')", [userId, `p3-${userId}`]);
    await pool.query("INSERT INTO workspaces (id, name, workspace_type) VALUES (?, 'Bootstrap Legacy Workspace', NULL)", [workspaceId]);
    await pool.query("INSERT INTO workspace_memberships (workspace_id, user_id, role, membership_source) VALUES (?, ?, NULL, NULL)", [workspaceId, userId]);
    const rows = await pool.query<{ workspace_type: string | null; role: string | null }[]>(
      "SELECT w.workspace_type, m.role FROM workspaces w INNER JOIN workspace_memberships m ON m.workspace_id = w.id WHERE w.id = ?",
      [workspaceId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].workspace_type).toBeNull();
    expect(rows[0].role).toBeNull();
  });
});

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
import { bootstrapWorkspaceGovernance } from "../../scripts/db/bootstrap-phase3-workspace-governance";
import { backfillPersonalWorkspaces } from "../../scripts/db/backfill-personal-workspaces";
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
      // Stops at 008 by design: the unbootstrapped legacy seed is exactly
      // what 009 fails closed on (see the 009 gate tests below).
      await runMigrations(legacyPool, migrations, { to: 8 });
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
      // Stops at 008 by design: the unbootstrapped legacy seed is exactly
      // what 009 fails closed on (see the 009 gate tests below).
      await runMigrations(legacyPool, migrations, { to: 8 });
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

  // Pre-009 contract on an isolated 008 database: NULL role/source rows are
  // still storable for the governance bootstrap to repair. Migration 009
  // forbids them (see gate F below); the shared pool runs at 009.
  it("membership role/membership_source may remain nullable until bootstrap", async () => {
    const { handle, pool: stagingPool } = await createIsolatedPool();
    try {
      await runMigrations(stagingPool, migrations, { to: 8 });
      const userId = uuidv7();
      const workspaceId = uuidv7();
      await stagingPool.query("INSERT INTO users (id, emp_id, name, org_code) VALUES (?, ?, 'Nullable Role User', 'P3')", [userId, `p3-${userId}`]);
      await stagingPool.query("INSERT INTO workspaces (id, name, workspace_type) VALUES (?, 'Nullable Role Workspace', 'TEAM')", [workspaceId]);
      await stagingPool.query("INSERT INTO workspace_memberships (workspace_id, user_id, role, membership_source) VALUES (?, ?, NULL, NULL)", [workspaceId, userId]);
      const rows = await stagingPool.query<{ role: string | null; membership_source: string | null }[]>(
        "SELECT role, membership_source FROM workspace_memberships WHERE workspace_id = ? AND user_id = ?",
        [workspaceId, userId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].role).toBeNull();
      expect(rows[0].membership_source).toBeNull();
    } finally {
      await disposePool(handle, stagingPool);
    }
  });

  it("personal_owner_user_id is nullable but UNIQUE already in 008", async () => {
    const constraints = await pool.query<{ CONSTRAINT_NAME: string }[]>(
      "SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'workspaces' AND CONSTRAINT_TYPE = 'UNIQUE'",
    );
    expect(constraints.map((row) => row.CONSTRAINT_NAME)).toContain("uq_workspaces_personal_owner");

    const indexes = await pool.query<{ INDEX_NAME: string; NON_UNIQUE: number; COLUMN_NAME: string }[]>(
      "SELECT INDEX_NAME, NON_UNIQUE, COLUMN_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'workspaces' AND INDEX_NAME = 'uq_workspaces_personal_owner'",
    );
    expect(indexes).toHaveLength(1);
    expect(Number(indexes[0].NON_UNIQUE)).toBe(0);
    expect(indexes[0].COLUMN_NAME).toBe("personal_owner_user_id");

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
      await repositories.workspaceMemberships.insert(createDirectMembership({ workspaceId, userId, role: "EDITOR", createdBy: userId, now }));
    });
    const rows = await pool.query<{ role: string | null; membership_source: string | null; created_by: string | null; updated_at: unknown }[]>(
      "SELECT role, membership_source, created_by, updated_at FROM workspace_memberships WHERE workspace_id = ? AND user_id = ?",
      [workspaceId, userId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].role).toBe("EDITOR");
    expect(rows[0].membership_source).toBe("DIRECT");
    expect(String(rows[0].created_by)).toBe(userId);
    expect(rows[0].updated_at).not.toBeNull();
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

  // Raw-SQL NULL inserts are an 008-only bootstrap-modeling tool on an
  // isolated database. Under 009 they are rejected at the DB boundary.
  it("legacy raw NULL rows remain possible only for controlled bootstrap tests", async () => {
    const { handle, pool: stagingPool } = await createIsolatedPool();
    try {
      await runMigrations(stagingPool, migrations, { to: 8 });
      const userId = uuidv7();
      const workspaceId = uuidv7();
      await stagingPool.query("INSERT INTO users (id, emp_id, name, org_code) VALUES (?, ?, 'Bootstrap Legacy', 'P3')", [userId, `p3-${userId}`]);
      await stagingPool.query("INSERT INTO workspaces (id, name, workspace_type) VALUES (?, 'Bootstrap Legacy Workspace', NULL)", [workspaceId]);
      await stagingPool.query("INSERT INTO workspace_memberships (workspace_id, user_id, role, membership_source) VALUES (?, ?, NULL, NULL)", [workspaceId, userId]);
      const rows = await stagingPool.query<{ workspace_type: string | null; role: string | null }[]>(
        "SELECT w.workspace_type, m.role FROM workspaces w INNER JOIN workspace_memberships m ON m.workspace_id = w.id WHERE w.id = ?",
        [workspaceId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].workspace_type).toBeNull();
      expect(rows[0].role).toBeNull();
    } finally {
      await disposePool(handle, stagingPool);
    }
  });
});

describe("Migration 009 final constraints gate (Task 11)", () => {
  async function appliedVersions(target: Pool): Promise<number[]> {
    const rows = await target.query<{ version: number }[]>("SELECT version FROM schema_migrations ORDER BY version");
    return rows.map((row) => Number(row.version));
  }

  async function seedLegacyTeam(target: Pool): Promise<{ userId: string; workspaceId: string }> {
    const userId = uuidv7();
    const workspaceId = uuidv7();
    await target.query("INSERT INTO users (id, emp_id, name, org_code) VALUES (?, ?, 'Gate Legacy User', 'GATE')", [userId, `gate-${userId}`]);
    await target.query("INSERT INTO workspaces (id, name) VALUES (?, 'Gate Legacy Team')", [workspaceId]);
    await target.query("INSERT INTO workspace_memberships (workspace_id, user_id) VALUES (?, ?)", [workspaceId, userId]);
    return { userId, workspaceId };
  }

  async function seedHealthyTeam(target: Pool): Promise<{ userId: string; workspaceId: string }> {
    const userId = uuidv7();
    const workspaceId = uuidv7();
    await target.query("INSERT INTO users (id, emp_id, name, org_code) VALUES (?, ?, 'Gate Healthy User', 'GATE')", [userId, `gate-${userId}`]);
    await target.query("INSERT INTO workspaces (id, name, workspace_type) VALUES (?, 'Gate Healthy Team', 'TEAM')", [workspaceId]);
    await target.query(
      "INSERT INTO workspace_memberships (workspace_id, user_id, role, membership_source) VALUES (?, ?, 'OWNER', 'DIRECT')",
      [workspaceId, userId],
    );
    return { userId, workspaceId };
  }

  it("A. 009 refuses before governance bootstrap with no APPLIED ledger row", async () => {
    const { handle, pool: gatePool } = await createIsolatedPool();
    try {
      await runMigrations(gatePool, migrations, { to: 8 });
      await seedLegacyTeam(gatePool);
      await expect(runMigrations(gatePool, migrations)).rejects.toThrow(/refused|OWNER|governance/i);
      expect(await appliedVersions(gatePool)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    } finally {
      await disposePool(handle, gatePool);
    }
  });

  it("B. bootstrap-satisfied governance without Personal backfill is still refused", async () => {
    const { handle, pool: gatePool } = await createIsolatedPool();
    try {
      await runMigrations(gatePool, migrations, { to: 8 });
      await seedHealthyTeam(gatePool);
      const bootstrap = await bootstrapWorkspaceGovernance(gatePool, { owners: {} });
      expect(bootstrap.teams).toBeGreaterThanOrEqual(1);
      await expect(runMigrations(gatePool, migrations)).rejects.toThrow(/personal|My Space/i);
      expect(await appliedVersions(gatePool)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    } finally {
      await disposePool(handle, gatePool);
    }
  });

  it("D. synthetic post-bootstrap legacy NULL row fails closed", async () => {
    const { handle, pool: gatePool } = await createIsolatedPool();
    try {
      await runMigrations(gatePool, migrations, { to: 8 });
      const { userId } = await seedHealthyTeam(gatePool);
      await bootstrapWorkspaceGovernance(gatePool, { owners: {} });
      await backfillPersonalWorkspaces(gatePool);
      const staleWorkspaceId = uuidv7();
      await gatePool.query("INSERT INTO workspaces (id, name, workspace_type) VALUES (?, 'Stale Synthetic Team', NULL)", [staleWorkspaceId]);
      await gatePool.query("INSERT INTO workspace_memberships (workspace_id, user_id, role, membership_source) VALUES (?, ?, NULL, NULL)", [
        staleWorkspaceId,
        userId,
      ]);
      await expect(runMigrations(gatePool, migrations)).rejects.toThrow(/NULL|role|workspace_type/i);
      expect(await appliedVersions(gatePool)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    } finally {
      await disposePool(handle, gatePool);
    }
  });

  it("E. repairing the stale row restores eligibility and applies 009", async () => {
    const { handle, pool: gatePool } = await createIsolatedPool();
    try {
      await runMigrations(gatePool, migrations, { to: 8 });
      const { userId } = await seedHealthyTeam(gatePool);
      await bootstrapWorkspaceGovernance(gatePool, { owners: {} });
      await backfillPersonalWorkspaces(gatePool);
      const staleWorkspaceId = uuidv7();
      await gatePool.query("INSERT INTO workspaces (id, name, workspace_type) VALUES (?, 'Stale Synthetic Team', NULL)", [staleWorkspaceId]);
      await gatePool.query("INSERT INTO workspace_memberships (workspace_id, user_id, role, membership_source) VALUES (?, ?, NULL, NULL)", [
        staleWorkspaceId,
        userId,
      ]);
      await gatePool.query("UPDATE workspaces SET workspace_type = 'TEAM' WHERE id = ?", [staleWorkspaceId]);
      await gatePool.query(
        "UPDATE workspace_memberships SET role = 'OWNER', membership_source = 'DIRECT' WHERE workspace_id = ? AND user_id = ?",
        [staleWorkspaceId, userId],
      );
      await runMigrations(gatePool, migrations);
      expect(await appliedVersions(gatePool)).toContain(9);
      const ledger = await gatePool.query<{ version: number; state: string }[]>(
        "SELECT version, state FROM schema_migrations WHERE version = 9",
      );
      expect(ledger.map((row) => [Number(row.version), row.state])).toEqual([[9, "APPLIED"]]);
    } finally {
      await disposePool(handle, gatePool);
    }
  });

  it("F. 009 final schema rejects NULL/invalid role/source/type", async () => {
    const userId = uuidv7();
    const workspaceId = uuidv7();
    await pool.query("INSERT INTO users (id, emp_id, name, org_code) VALUES (?, ?, 'Final Gate User', 'GATE')", [userId, `gate-${userId}`]);
    await pool.query("INSERT INTO workspaces (id, name, workspace_type) VALUES (?, 'Final Gate Team', 'TEAM')", [workspaceId]);
    await expect(
      pool.query("INSERT INTO workspace_memberships (workspace_id, user_id, role, membership_source) VALUES (?, ?, NULL, 'DIRECT')", [workspaceId, userId]),
    ).rejects.toThrow();
    await expect(
      pool.query("INSERT INTO workspace_memberships (workspace_id, user_id, role, membership_source) VALUES (?, ?, 'EDITOR', NULL)", [workspaceId, userId]),
    ).rejects.toThrow();
    await expect(
      pool.query("INSERT INTO workspace_memberships (workspace_id, user_id, role, membership_source) VALUES (?, ?, 'SUPERADMIN', 'DIRECT')", [workspaceId, userId]),
    ).rejects.toThrow();
    await expect(
      pool.query("INSERT INTO workspace_memberships (workspace_id, user_id, role, membership_source) VALUES (?, ?, 'EDITOR', 'MAGIC')", [workspaceId, userId]),
    ).rejects.toThrow();
    await expect(
      pool.query("INSERT INTO workspace_memberships (workspace_id, user_id, role, membership_source) VALUES (?, ?, 'EDITOR', 'SYSTEM_PERSONAL')", [workspaceId, userId]),
    ).rejects.toThrow();
    await expect(
      pool.query("INSERT INTO workspaces (id, name, workspace_type) VALUES (?, 'Null Type Team', NULL)", [uuidv7()]),
    ).rejects.toThrow();
    await expect(
      pool.query("INSERT INTO workspaces (id, name, workspace_type) VALUES (?, 'Tribe Team', 'TRIBE')", [uuidv7()]),
    ).rejects.toThrow();
    await expect(
      pool.query("INSERT INTO workspaces (id, name, workspace_type, lifecycle_state) VALUES (?, 'Deleted Team', 'TEAM', 'DELETED')", [uuidv7()]),
    ).rejects.toThrow();
    await expect(
      pool.query("INSERT INTO workspaces (id, name, workspace_type, personal_owner_user_id) VALUES (?, 'Owned Team', 'TEAM', ?)", [uuidv7(), userId]),
    ).rejects.toThrow();
    await expect(
      pool.query("INSERT INTO workspaces (id, name, workspace_type, personal_owner_user_id) VALUES (?, 'Ownerless Personal', 'PERSONAL', NULL)", [uuidv7()]),
    ).rejects.toThrow();
    await expect(
      pool.query("INSERT INTO workspaces (id, name, workspace_type, personal_owner_user_id) VALUES (?, 'Renamed Space', 'PERSONAL', ?)", [uuidv7(), userId]),
    ).rejects.toThrow();
  });

  it("G. canonical 009 FKs reject orphan relationships", async () => {
    const missingUserId = uuidv7();
    await expect(
      pool.query("INSERT INTO workspaces (id, name, workspace_type, personal_owner_user_id) VALUES (?, 'My Space', 'PERSONAL', ?)", [uuidv7(), missingUserId]),
    ).rejects.toThrow();
    await expect(
      pool.query("INSERT INTO workspaces (id, name, workspace_type, created_by) VALUES (?, 'Orphan Creator', 'TEAM', ?)", [uuidv7(), missingUserId]),
    ).rejects.toThrow();
    await expect(
      pool.query("INSERT INTO workspaces (id, name, workspace_type, archived_by) VALUES (?, 'Orphan Archiver', 'TEAM', ?)", [uuidv7(), missingUserId]),
    ).rejects.toThrow();
    const workspaceId = uuidv7();
    await pool.query("INSERT INTO workspaces (id, name, workspace_type) VALUES (?, 'Orphan Probe Team', 'TEAM')", [workspaceId]);
    await expect(
      pool.query("INSERT INTO workspace_group_mappings (id, workspace_id, external_group_id, role, created_by) VALUES (?, ?, ?, 'VIEWER', ?)", [
        uuidv7(),
        workspaceId,
        Buffer.from("orphan-009-group", "utf8"),
        missingUserId,
      ]),
    ).rejects.toThrow();
    await expect(
      pool.query("INSERT INTO workspace_audit_events (id, workspace_id, actor_user_id, actor_kind, event_type) VALUES (?, ?, ?, 'USER', 'TEAM_WORKSPACE_CREATED')", [
        uuidv7(),
        workspaceId,
        missingUserId,
      ]),
    ).rejects.toThrow();
  });

  it("H. 008 personal-owner UNIQUE survives 009", async () => {
    const constraints = await pool.query<{ CONSTRAINT_NAME: string }[]>(
      "SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'workspaces' AND CONSTRAINT_TYPE = 'UNIQUE'",
    );
    expect(constraints.map((row) => row.CONSTRAINT_NAME)).toContain("uq_workspaces_personal_owner");
    const ownerId = uuidv7();
    await pool.query("INSERT INTO users (id, emp_id, name, org_code) VALUES (?, ?, 'Final Owner', 'GATE')", [ownerId, `gate-${ownerId}`]);
    await pool.query("INSERT INTO workspaces (id, name, workspace_type, personal_owner_user_id) VALUES (?, 'My Space', 'PERSONAL', ?)", [uuidv7(), ownerId]);
    await expect(
      pool.query("INSERT INTO workspaces (id, name, workspace_type, personal_owner_user_id) VALUES (?, 'My Space', 'PERSONAL', ?)", [uuidv7(), ownerId]),
    ).rejects.toThrow();
  });

  it("F-provenance. 009 adds membership created_by/updated_at; legacy NULL created_by allowed, updated_at NOT NULL", async () => {
    const columns = await pool.query<{ COLUMN_NAME: string; IS_NULLABLE: string }[]>(
      "SELECT COLUMN_NAME, IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'workspace_memberships' AND COLUMN_NAME IN ('created_by', 'updated_at')",
    );
    expect(columns.map((row) => String(row.COLUMN_NAME)).sort()).toEqual(["created_by", "updated_at"]);
    const nullability = new Map(columns.map((row) => [String(row.COLUMN_NAME), String(row.IS_NULLABLE)]));
    expect(nullability.get("created_by")).toBe("YES");
    expect(nullability.get("updated_at")).toBe("NO");

    const userId = uuidv7();
    const workspaceId = uuidv7();
    await pool.query("INSERT INTO users (id, emp_id, name, org_code) VALUES (?, ?, 'Provenance User', 'GATE')", [userId, `gate-${userId}`]);
    await pool.query("INSERT INTO workspaces (id, name, workspace_type) VALUES (?, 'Provenance Team', 'TEAM')", [workspaceId]);
    await pool.query(
      "INSERT INTO workspace_memberships (workspace_id, user_id, role, membership_source, created_by) VALUES (?, ?, 'EDITOR', 'DIRECT', NULL)",
      [workspaceId, userId],
    );
    const rows = await pool.query<{ created_by: string | null; updated_at: unknown; created_at: unknown }[]>(
      "SELECT created_by, updated_at, created_at FROM workspace_memberships WHERE workspace_id = ? AND user_id = ?",
      [workspaceId, userId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].created_by).toBeNull();
    expect(rows[0].updated_at).not.toBeNull();
    await expect(
      pool.query("UPDATE workspace_memberships SET updated_at = NULL WHERE workspace_id = ? AND user_id = ?", [workspaceId, userId]),
    ).rejects.toThrow();
  });

  it("F-backfill. 009 lands legacy membership rows on NOT NULL updated_at and NULL created_by", async () => {
    const { handle, pool: gatePool } = await createIsolatedPool();
    try {
      await runMigrations(gatePool, migrations, { to: 8 });
      const { userId, workspaceId } = await seedHealthyTeam(gatePool);
      await bootstrapWorkspaceGovernance(gatePool, { owners: {} });
      await backfillPersonalWorkspaces(gatePool);
      await runMigrations(gatePool, migrations);
      expect(await appliedVersions(gatePool)).toContain(9);
      const rows = await gatePool.query<{ created_by: string | null; updated_at: unknown }[]>(
        "SELECT created_by, updated_at FROM workspace_memberships WHERE workspace_id = ? AND user_id = ?",
        [workspaceId, userId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].created_by).toBeNull();
      expect(rows[0].updated_at).not.toBeNull();
    } finally {
      await disposePool(handle, gatePool);
    }
  });

  it("I. 009 refuses group mappings attached to PERSONAL workspaces", async () => {
    const { handle, pool: gatePool } = await createIsolatedPool();
    try {
      await runMigrations(gatePool, migrations, { to: 8 });
      const { userId } = await seedHealthyTeam(gatePool);
      await bootstrapWorkspaceGovernance(gatePool, { owners: {} });
      await backfillPersonalWorkspaces(gatePool);
      const personal = await gatePool.query<{ id: string }[]>(
        "SELECT id FROM workspaces WHERE workspace_type = 'PERSONAL' AND personal_owner_user_id = ?",
        [userId],
      );
      expect(personal).toHaveLength(1);
      const mappingId = uuidv7();
      await gatePool.query(
        "INSERT INTO workspace_group_mappings (id, workspace_id, external_group_id, role) VALUES (?, ?, ?, 'VIEWER')",
        [mappingId, String(personal[0].id), Buffer.from("sso-personal-group", "utf8")],
      );
      await expect(runMigrations(gatePool, migrations)).rejects.toThrow(/PERSONAL|group/i);
      expect(await appliedVersions(gatePool)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      await gatePool.query("DELETE FROM workspace_group_mappings WHERE id = ?", [mappingId]);
      await runMigrations(gatePool, migrations);
      expect(await appliedVersions(gatePool)).toContain(9);
    } finally {
      await disposePool(handle, gatePool);
    }
  });
});

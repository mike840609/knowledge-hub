import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { uuidv7 } from "@/shared/ids/uuidv7";
import { PERSONAL_WORKSPACE_NAME, PERSONAL_WORKSPACE_PROVISIONED_EVENT } from "@/modules/workspaces/application/personal-workspace-service";

/**
 * Phase 3 Personal workspace backfill (spec §5).
 *
 * Gives every existing Hub user exactly one My Space plus its
 * OWNER/SYSTEM_PERSONAL membership. Runs under migration 008 only (009
 * final constraints are a later task), so provisioning here uses 008-era
 * raw SQL — the canonical repository writers target 009 (membership
 * created_by/updated_at) and cannot run pre-009. Operator-created rows keep
 * created_by NULL (legacy provenance); migration 009 backfills updated_at
 * from created_at. The 008 owner UNIQUE constraint keeps concurrent
 * provisioning and backfill idempotent. Reruns are no-ops. Never applies
 * migrations.
 */
export type PersonalBackfillResult = {
  users: number;
  provisioned: number;
  alreadyProvisioned: number;
};

export async function backfillPersonalWorkspaces(pool: Pool): Promise<PersonalBackfillResult> {
  const userRows = await pool.query<{ id: unknown }[]>("SELECT id FROM users ORDER BY id");
  const userIds = userRows.map((row) => String(row.id));

  let provisioned = 0;
  let alreadyProvisioned = 0;
  for (const userId of userIds) {
    if (await provisionMySpace(pool, userId)) provisioned += 1;
    else alreadyProvisioned += 1;
  }

  const problems: string[] = [];
  for (const userId of userIds) {
    const workspaces = await pool.query<{ id: unknown; name: unknown; workspace_type: unknown }[]>(
      "SELECT id, name, workspace_type FROM workspaces WHERE personal_owner_user_id = ?",
      [userId],
    );
    if (workspaces.length !== 1) {
      problems.push(`user ${userId} has ${workspaces.length} personal workspaces, expected exactly 1`);
      continue;
    }
    if (String(workspaces[0].name) !== PERSONAL_WORKSPACE_NAME || workspaces[0].workspace_type !== "PERSONAL") {
      problems.push(`user ${userId} personal workspace is not a My Space PERSONAL row`);
      continue;
    }
    const memberships = await pool.query<{ count: number }[]>(
      `SELECT COUNT(*) AS count FROM workspace_memberships
        WHERE workspace_id = ? AND user_id = ? AND role = 'OWNER' AND membership_source = 'SYSTEM_PERSONAL'`,
      [String(workspaces[0].id), userId],
    );
    if (Number(memberships[0].count) !== 1) {
      problems.push(`user ${userId} personal workspace is missing its OWNER/SYSTEM_PERSONAL membership`);
    }
  }
  if (problems.length > 0) {
    throw new Error(`Personal backfill verification failed:\n- ${problems.join("\n- ")}`);
  }
  return { users: userIds.length, provisioned, alreadyProvisioned };
}

/**
 * 008-era My Space provisioning. Uses only columns that exist at 008 and
 * records no actor (created_by stays NULL for operator rows, per spec §8.2
 * legacy provenance). Returns true when this call created the workspace.
 */
async function provisionMySpace(pool: Pool, userId: string): Promise<boolean> {
  const existing = await pool.query<{ id: unknown }[]>(
    "SELECT id FROM workspaces WHERE personal_owner_user_id = ? LIMIT 1",
    [userId],
  );
  if (existing.length > 0) return false;
  const now = new Date();
  const workspaceId = uuidv7();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    try {
      await connection.query(
        `INSERT INTO workspaces (id, name, workspace_type, personal_owner_user_id, lifecycle_state, created_by, archived_by, archived_at, created_at, updated_at)
         VALUES (?, ?, 'PERSONAL', ?, 'ACTIVE', ?, NULL, NULL, ?, ?)`,
        [workspaceId, PERSONAL_WORKSPACE_NAME, userId, userId, now, now],
      );
      await connection.query(
        "INSERT INTO workspace_memberships (workspace_id, user_id, role, membership_source) VALUES (?, ?, 'OWNER', 'SYSTEM_PERSONAL')",
        [workspaceId, userId],
      );
      await connection.query(
        `INSERT INTO workspace_audit_events (id, workspace_id, actor_user_id, actor_kind, event_type, target_type, target_id, payload, correlation_id, created_at)
         VALUES (?, ?, ?, 'SYSTEM', ?, 'USER', ?, ?, NULL, ?)`,
        [uuidv7(), workspaceId, userId, PERSONAL_WORKSPACE_PROVISIONED_EVENT, userId, JSON.stringify({ workspaceType: "PERSONAL" }), now],
      );
      await connection.commit();
    } catch (error) {
      try { await connection.rollback(); } catch { /* preserve the original failure */ }
      if (!isDuplicateEntry(error)) throw error;
      const winner = await pool.query<{ id: unknown }[]>(
        "SELECT id FROM workspaces WHERE personal_owner_user_id = ? LIMIT 1",
        [userId],
      );
      if (winner.length === 0) throw error;
      return false;
    }
  } finally {
    connection.release();
  }
  return true;
}

function isDuplicateEntry(error: unknown): boolean {
  const code = (error as { errno?: unknown; code?: unknown })?.errno ?? (error as { code?: unknown })?.code;
  return code === 1062 || code === "ER_DUP_ENTRY";
}

const PERSONAL_BACKFILL_HELP = `Usage: npx tsx scripts/db/backfill-personal-workspaces.ts [--target dev|test|e2e]

Phase 3 Personal workspace backfill (migration 008 only; never applies 009).
Every Hub user ends with exactly one My Space (PERSONAL) plus its
OWNER/SYSTEM_PERSONAL membership. Idempotent and rerunnable: users that
already have a My Space are verified, not duplicated.

Run under canonical-write quiescence. See
docs/operations/phase3-workspace-governance-cutover.md.
`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(PERSONAL_BACKFILL_HELP);
    return;
  }
  const targetIndex = args.indexOf("--target");
  const target = targetIndex === -1 ? "dev" : args[targetIndex + 1];
  if (target !== "dev" && target !== "test" && target !== "e2e") {
    throw new Error("Invalid arguments. Expected: [--target dev|test|e2e].");
  }
  const pool = createDatabasePool(databaseConfig(target));
  try {
    const result = await backfillPersonalWorkspaces(pool);
    console.log(
      `Personal backfill complete: ${result.users} Hub users verified, ` +
        `${result.provisioned} provisioned, ${result.alreadyProvisioned} already provisioned.`,
    );
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

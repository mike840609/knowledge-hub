import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { PERSONAL_WORKSPACE_NAME, PersonalWorkspaceService } from "@/modules/workspaces/application/personal-workspace-service";

/**
 * Phase 3 Personal workspace backfill (spec §5).
 *
 * Gives every existing Hub user exactly one My Space plus its
 * OWNER/SYSTEM_PERSONAL membership, reusing the same idempotent
 * provisioning primitive as login-time provisioning. The 008 owner UNIQUE
 * constraint plus application re-read keeps concurrent provisioning and
 * backfill idempotent. Reruns are no-ops. Never applies migrations: run
 * under migration 008 only (009 final constraints are a later task).
 */
export type PersonalBackfillResult = {
  users: number;
  provisioned: number;
  alreadyProvisioned: number;
};

export async function backfillPersonalWorkspaces(pool: Pool): Promise<PersonalBackfillResult> {
  const service = new PersonalWorkspaceService(new MariaDbUnitOfWork(pool));
  const userRows = await pool.query<{ id: unknown }[]>("SELECT id FROM users ORDER BY id");
  const userIds = userRows.map((row) => String(row.id));

  let provisioned = 0;
  let alreadyProvisioned = 0;
  for (const userId of userIds) {
    const result = await service.ensurePersonalWorkspace(userId);
    if (result.created) provisioned += 1;
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

import { readFile } from "node:fs/promises";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { affectedRows } from "@/infrastructure/database/mariadb/repositories/shared";
import { isUuid } from "@/shared/ids/uuidv7";

/**
 * Phase 3 explicit Team governance bootstrap (spec §15.3).
 *
 * Every legacy TEAM workspace must end with direct OWNER >= 1 before
 * migration 009. Owners come ONLY from the operator-provided config mapping
 * `workspaceId -> ownerUserId`. The script never guesses an owner from row
 * order, org_code, name, or member count: a Team without a direct OWNER and
 * without an explicit entry fails closed, as does any config entry pointing
 * at an unknown workspace or unknown user, and any membership row whose
 * NULL/invalid role or membership_source is not covered by an explicit
 * owner entry for that exact (workspace, user) pair.
 *
 * Runs under canonical-write quiescence (see the production cutover
 * runbook). All checks and writes happen in a single all-or-nothing
 * transaction; reruns with the same config are no-ops.
 */
export type GovernanceBootstrapConfig = {
  owners: Record<string, string>;
};

export type GovernanceBootstrapResult = {
  teams: number;
  elevated: number;
  inserted: number;
  alreadySatisfied: number;
};

const VALID_ROLES = new Set(["OWNER", "ADMIN", "EDITOR", "VIEWER"]);
const VALID_SOURCES = new Set(["DIRECT", "SYSTEM_PERSONAL"]);

export function parseGovernanceBootstrapConfig(raw: unknown): GovernanceBootstrapConfig {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Governance bootstrap config must be a JSON object with an \"owners\" mapping.");
  }
  const owners = (raw as { owners?: unknown }).owners;
  if (owners === null || typeof owners !== "object" || Array.isArray(owners)) {
    throw new Error("Governance bootstrap config must contain an \"owners\" object mapping workspace ID to owner user ID.");
  }
  const parsed: Record<string, string> = {};
  for (const [workspaceId, userId] of Object.entries(owners as Record<string, unknown>)) {
    if (!isUuid(workspaceId)) throw new Error(`Governance bootstrap refused: owner mapping key is not a UUID: ${workspaceId}.`);
    if (typeof userId !== "string" || !isUuid(userId)) {
      throw new Error(`Governance bootstrap refused: owner target for workspace ${workspaceId} is not a UUID.`);
    }
    parsed[workspaceId] = userId;
  }
  return { owners: parsed };
}

type MembershipRow = {
  workspace_id: string;
  user_id: string;
  role: string | null;
  membership_source: string | null;
};

export async function bootstrapWorkspaceGovernance(pool: Pool, config: GovernanceBootstrapConfig): Promise<GovernanceBootstrapResult> {
  const entries = Object.entries(config.owners);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const teamRows = await connection.query<{ id: string }[]>(
      "SELECT id FROM workspaces WHERE COALESCE(workspace_type, 'TEAM') = 'TEAM' ORDER BY id FOR UPDATE",
    );
    const teamIds = teamRows.map((row) => String(row.id));
    const teamSet = new Set(teamIds);
    const workspaceKinds = new Map<string, string>();
    if (teamIds.length > 0) {
      const kinds = await connection.query<{ id: string; workspace_type: string | null }[]>(
        "SELECT id, workspace_type FROM workspaces WHERE COALESCE(workspace_type, 'TEAM') = 'TEAM'",
      );
      for (const row of kinds) workspaceKinds.set(String(row.id), row.workspace_type ?? "TEAM");
    }
    const allWorkspaceRows = await connection.query<{ id: string }[]>("SELECT id FROM workspaces");
    const allWorkspaceIds = new Set(allWorkspaceRows.map((row) => String(row.id)));
    const userRows = await connection.query<{ id: string }[]>("SELECT id FROM users");
    const userIds = new Set(userRows.map((row) => String(row.id)));
    const memberRows = await connection.query<MembershipRow[]>(
      "SELECT workspace_id, user_id, role, membership_source FROM workspace_memberships ORDER BY workspace_id, user_id FOR UPDATE",
    );
    const membersByTeam = new Map<string, MembershipRow[]>();
    for (const row of memberRows) {
      const workspaceId = String(row.workspace_id);
      const list = membersByTeam.get(workspaceId) ?? [];
      list.push({ workspace_id: workspaceId, user_id: String(row.user_id), role: row.role, membership_source: row.membership_source });
      membersByTeam.set(workspaceId, list);
    }

    const problems: string[] = [];
    for (const [workspaceId, userId] of entries) {
      if (!allWorkspaceIds.has(workspaceId)) {
        problems.push(`explicit owner entry targets unknown workspace ${workspaceId}`);
      } else if (!teamSet.has(workspaceId)) {
        problems.push(`explicit owner entry targets workspace ${workspaceId}, which is not a TEAM workspace`);
      }
      if (!userIds.has(userId)) {
        problems.push(`explicit owner entry for workspace ${workspaceId} targets unknown user ${userId}`);
      }
    }

    const pendingElevation = new Map<string, string>();
    for (const workspaceId of teamIds) {
      const members = membersByTeam.get(workspaceId) ?? [];
      const explicitOwner = entries.find(([id]) => id === workspaceId)?.[1];
      for (const member of members) {
        const coveredByExplicit = explicitOwner !== undefined && member.user_id === explicitOwner;
        const roleValid = member.role !== null && VALID_ROLES.has(member.role);
        const sourceValid = member.membership_source !== null && VALID_SOURCES.has(member.membership_source);
        if ((!roleValid || !sourceValid) && !coveredByExplicit) {
          problems.push(
            `workspace ${workspaceId} member ${member.user_id} has invalid role/source ` +
              `(role=${String(member.role)}, source=${String(member.membership_source)}); fix the row or cover it with an explicit owner entry`,
          );
        }
      }
      const hasDirectOwner = members.some((member) => member.role === "OWNER" && member.membership_source === "DIRECT");
      if (!hasDirectOwner && explicitOwner === undefined) {
        problems.push(
          `workspace ${workspaceId} (${workspaceKinds.get(workspaceId) ?? "TEAM"}) has no direct OWNER and no explicit owner entry; ` +
            `add "owners": { "${workspaceId}": "<existing-hub-user-id>" }`,
        );
      }
      if (explicitOwner !== undefined && !problems.some((problem) => problem.includes(workspaceId))) {
        pendingElevation.set(workspaceId, explicitOwner);
      }
    }

    if (problems.length > 0) {
      throw new Error(`Governance bootstrap refused:\n- ${problems.join("\n- ")}`);
    }

    let elevated = 0;
    let inserted = 0;
    let alreadySatisfied = 0;
    for (const [workspaceId, userId] of pendingElevation) {
      const existing = (membersByTeam.get(workspaceId) ?? []).find((member) => member.user_id === userId);
      if (existing && existing.role === "OWNER" && existing.membership_source === "DIRECT") {
        alreadySatisfied += 1;
        continue;
      }
      if (existing) {
        const result = await connection.query(
          "UPDATE workspace_memberships SET role = 'OWNER', membership_source = 'DIRECT' WHERE workspace_id = ? AND user_id = ?",
          [workspaceId, userId],
        );
        if (affectedRows(result) !== 1) {
          throw new Error(`Governance bootstrap refused: owner elevation for workspace ${workspaceId} member ${userId} did not apply.`);
        }
        elevated += 1;
      } else {
        await connection.query(
          "INSERT INTO workspace_memberships (workspace_id, user_id, role, membership_source) VALUES (?, ?, 'OWNER', 'DIRECT')",
          [workspaceId, userId],
        );
        inserted += 1;
      }
    }

    const verify = await connection.query<{ workspace_id: string }[]>(
      `SELECT m.workspace_id FROM workspace_memberships m
        JOIN workspaces w ON w.id = m.workspace_id
        WHERE COALESCE(w.workspace_type, 'TEAM') = 'TEAM'
        GROUP BY m.workspace_id
        HAVING SUM(m.role = 'OWNER' AND m.membership_source = 'DIRECT') < 1`,
    );
    const uncovered = verify.map((row) => String(row.workspace_id));
    const emptyTeams = teamIds.filter(
      (id) => !(membersByTeam.get(id) ?? []).length && !pendingElevation.has(id),
    );
    if (uncovered.length > 0 || emptyTeams.length > 0) {
      throw new Error(
        `Governance bootstrap refused: teams without direct OWNER remain: ${[...uncovered, ...emptyTeams].join(", ")}.`,
      );
    }

    await connection.commit();
    return { teams: teamIds.length, elevated, inserted, alreadySatisfied };
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      /* preserve the original failure */
    }
    throw error;
  } finally {
    connection.release();
  }
}

const GOVERNANCE_BOOTSTRAP_HELP = `Usage: npx tsx scripts/db/bootstrap-phase3-workspace-governance.ts --config <path> [--target dev|test|e2e]

Explicit Team governance bootstrap (migration 008 only; never applies 009).
Every legacy TEAM workspace ends with direct OWNER >= 1. Owners come ONLY
from the operator config mapping:

  { "owners": { "<workspace-id>": "<existing-hub-user-id>" } }

Rules (fail closed, single all-or-nothing transaction, rerunnable):
- No heuristic elevation: row order, org_code, name, and member count are
  never used to pick an owner. A Team without a direct OWNER and without an
  explicit entry is refused.
- Unknown owner targets (missing workspace or missing user) are refused.
- Membership rows with NULL/invalid role or membership_source are refused
  unless the exact (workspace, user) pair is covered by an explicit owner
  entry (which sets OWNER/DIRECT) or the operator fixes the row first.
- Zero-member Teams require an explicit OWNER entry for an existing Hub user.

Run under canonical-write quiescence. beforeApply checks and the migration
advisory lock are NOT application write fences. See
docs/operations/phase3-workspace-governance-cutover.md.
`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(GOVERNANCE_BOOTSTRAP_HELP);
    return;
  }
  const configIndex = args.indexOf("--config");
  const configPath = configIndex === -1 ? undefined : args[configIndex + 1];
  const targetIndex = args.indexOf("--target");
  const target = targetIndex === -1 ? "dev" : args[targetIndex + 1];
  if (!configPath || (target !== "dev" && target !== "test" && target !== "e2e")) {
    throw new Error("Invalid arguments. Expected: --config <path> [--target dev|test|e2e].");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(configPath, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read governance bootstrap config ${configPath}: ${error instanceof Error ? error.message : error}`);
  }
  const config = parseGovernanceBootstrapConfig(raw);
  const pool = createDatabasePool(databaseConfig(target));
  try {
    const result = await bootstrapWorkspaceGovernance(pool, config);
    console.log(
      `Governance bootstrap complete: ${result.teams} TEAM workspaces verified, ` +
        `${result.elevated} elevated, ${result.inserted} inserted, ${result.alreadySatisfied} already satisfied.`,
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

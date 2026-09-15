import type { Migration, MigrationReadConnection } from "./types";

/**
 * Phase 3 workspace governance finalization (migration 009).
 *
 * Finalizes the nullable bootstrap fields that migration 008 left open for
 * the governance, identity-link, and Personal backfill bootstraps: NOT NULL
 * on `workspaces.workspace_type` and membership `role`/`membership_source`,
 * role/source/type/lifecycle/actor CHECKs, canonical Workspace/User FKs, and
 * the PERSONAL canonical-shape coherence rules (TEAM rows carry no owner,
 * PERSONAL rows carry exactly one owner and the `My Space` name). It also
 * adds the membership provenance columns required by spec §8.2
 * (`created_by` UUID NULL for legacy rows, `updated_at` NOT NULL defaulting
 * to CURRENT_TIMESTAMP so legacy rows land on "now" and 008-era operator
 * SQL keeps working across the cutover) plus the `created_by` User FK.
 *
 * The 008 `UNIQUE(personal_owner_user_id)` constraint is preserved untouched
 * (no DDL here drops or recreates it).
 *
 * The `beforeApply` gate is READ-ONLY validation (SELECT/SHOW only — the
 * runner rejects anything else before it reaches MariaDB). It fails closed
 * when the Team governance bootstrap or the Personal backfill is incomplete,
 * when a stale/legacy NULL row exists, or when any orphan user reference
 * would violate the new FKs. A gate failure aborts the migration with no
 * APPLIED ledger row; the operator repairs the data (never the checksums)
 * and reruns. The gate never auto-repairs rows and never reads operator
 * input.
 *
 * The gate is NOT a write fence and the migration advisory lock is NOT an
 * application lock: canonical-write quiescence (maintenance from before 008
 * through 009 + Phase-3-compatible writer readiness) is the only supported
 * rollout. See docs/operations/phase3-workspace-governance-cutover.md.
 */

const VALID_ROLES = new Set(["OWNER", "ADMIN", "EDITOR", "VIEWER"]);
const VALID_SOURCES = new Set(["DIRECT", "SYSTEM_PERSONAL"]);
const VALID_TYPES = new Set(["TEAM", "PERSONAL"]);
const VALID_LIFECYCLES = new Set(["ACTIVE", "ARCHIVED"]);
const PERSONAL_WORKSPACE_NAME = "My Space";

type WorkspaceRow = {
  id: unknown;
  name: unknown;
  workspace_type: unknown;
  personal_owner_user_id: unknown;
  lifecycle_state: unknown;
  created_by: unknown;
  archived_by: unknown;
};

type MembershipRow = {
  workspace_id: unknown;
  user_id: unknown;
  role: unknown;
  membership_source: unknown;
};

function refuse(problems: string[]): never {
  throw new Error(
    `Migration 009 refused: workspace governance is not ready for final constraints:\n- ${problems.join("\n- ")}\nRepair the data (governance bootstrap, identity-link bootstrap, Personal backfill, or explicit row repair), then rerun the migration.`,
  );
}

async function assertGovernanceFinalizeReady(connection: MigrationReadConnection): Promise<void> {
  const problems: string[] = [];

  const users = await connection.query<{ id: unknown }[]>("SELECT id FROM users ORDER BY id");
  const userIds = new Set(users.map((row) => String(row.id)));

  const workspaces = await connection.query<WorkspaceRow[]>(
    "SELECT id, name, workspace_type, personal_owner_user_id, lifecycle_state, created_by, archived_by FROM workspaces ORDER BY id",
  );
  const workspaceById = new Map<string, WorkspaceRow>();
  for (const row of workspaces) workspaceById.set(String(row.id), row);

  for (const row of workspaces) {
    const id = String(row.id);
    const type = row.workspace_type === null ? null : String(row.workspace_type);
    const lifecycle = row.lifecycle_state === null ? null : String(row.lifecycle_state);
    const owner = row.personal_owner_user_id === null ? null : String(row.personal_owner_user_id);
    if (type === null || !VALID_TYPES.has(type)) {
      problems.push(`workspace ${id} has invalid workspace_type ${String(row.workspace_type)}; backfill TEAM explicitly, never guess.`);
      continue;
    }
    if (lifecycle === null || !VALID_LIFECYCLES.has(lifecycle)) {
      problems.push(`workspace ${id} has invalid lifecycle_state ${String(row.lifecycle_state)}.`);
    }
    if (type === "TEAM" && owner !== null) {
      problems.push(`workspace ${id} is TEAM but carries personal_owner_user_id ${owner}; TEAM rows must not be personally owned.`);
    }
    if (type === "PERSONAL") {
      if (owner === null) {
        problems.push(`workspace ${id} is PERSONAL without a personal_owner_user_id.`);
      } else if (!userIds.has(owner)) {
        problems.push(`workspace ${id} is PERSONAL but its owner ${owner} does not exist.`);
      }
      if (String(row.name) !== PERSONAL_WORKSPACE_NAME) {
        problems.push(`workspace ${id} is PERSONAL but is not named '${PERSONAL_WORKSPACE_NAME}'.`);
      }
    }
    for (const [column, value] of [["created_by", row.created_by], ["archived_by", row.archived_by]] as const) {
      if (value !== null && !userIds.has(String(value))) {
        problems.push(`workspace ${id} references unknown user ${String(value)} in ${column}.`);
      }
    }
  }

  const memberships = await connection.query<MembershipRow[]>(
    "SELECT workspace_id, user_id, role, membership_source FROM workspace_memberships ORDER BY workspace_id, user_id",
  );
  const membersByWorkspace = new Map<string, MembershipRow[]>();
  for (const row of memberships) {
    const workspaceId = String(row.workspace_id);
    const list = membersByWorkspace.get(workspaceId) ?? [];
    list.push(row);
    membersByWorkspace.set(workspaceId, list);
  }

  for (const row of memberships) {
    const where = `workspace ${String(row.workspace_id)} member ${String(row.user_id)}`;
    const role = row.role === null ? null : String(row.role);
    const source = row.membership_source === null ? null : String(row.membership_source);
    if (role === null || !VALID_ROLES.has(role)) {
      problems.push(`${where} has invalid role ${String(row.role)}; fix the row or cover it with the governance bootstrap.`);
    }
    if (source === null || !VALID_SOURCES.has(source)) {
      problems.push(`${where} has invalid membership_source ${String(row.membership_source)}; fix the row or cover it with the governance bootstrap.`);
    }
    if (source === "SYSTEM_PERSONAL" && role !== "OWNER") {
      problems.push(`${where} carries membership_source SYSTEM_PERSONAL without role OWNER.`);
    }
    if (source === "SYSTEM_PERSONAL") {
      const workspace = workspaceById.get(String(row.workspace_id));
      const userId = String(row.user_id);
      if (!workspace || String(workspace.workspace_type) !== "PERSONAL" || workspace.personal_owner_user_id === null || String(workspace.personal_owner_user_id) !== userId) {
        problems.push(`${where} carries membership_source SYSTEM_PERSONAL outside its own PERSONAL workspace.`);
      }
    }
  }

  for (const row of workspaces) {
    const id = String(row.id);
    if (String(row.workspace_type) !== "TEAM") continue;
    const members = membersByWorkspace.get(id) ?? [];
    const owners = members.filter((member) => String(member.role) === "OWNER" && String(member.membership_source) === "DIRECT").length;
    if (owners < 1) {
      problems.push(`TEAM workspace ${id} has no direct OWNER; run the governance bootstrap with an explicit owner entry.`);
    }
  }

  for (const userRow of users) {
    const userId = String(userRow.id);
    const owned = workspaces.filter(
      (row) => String(row.workspace_type) === "PERSONAL" && row.personal_owner_user_id !== null && String(row.personal_owner_user_id) === userId,
    );
    if (owned.length !== 1) {
      problems.push(`user ${userId} has ${owned.length} PERSONAL workspaces, expected exactly 1; run the Personal backfill.`);
      continue;
    }
    const personalId = String(owned[0].id);
    if (String(owned[0].name) !== PERSONAL_WORKSPACE_NAME) {
      problems.push(`user ${userId} personal workspace ${personalId} is not named '${PERSONAL_WORKSPACE_NAME}'.`);
    }
    const personalMembers = (membersByWorkspace.get(personalId) ?? []).filter(
      (member) => String(member.user_id) === userId && String(member.role) === "OWNER" && String(member.membership_source) === "SYSTEM_PERSONAL",
    );
    if (personalMembers.length !== 1) {
      problems.push(`user ${userId} personal workspace ${personalId} is missing its OWNER/SYSTEM_PERSONAL membership; run the Personal backfill.`);
    }
  }

  const groupCreators = await connection.query<{ created_by: unknown }[]>(
    "SELECT created_by FROM workspace_group_mappings WHERE created_by IS NOT NULL",
  );
  for (const row of groupCreators) {
    if (!userIds.has(String(row.created_by))) {
      problems.push(`a workspace_group_mapping references unknown user ${String(row.created_by)} in created_by.`);
      break;
    }
  }

  const groupMappings = await connection.query<{ id: unknown; workspace_id: unknown }[]>(
    "SELECT id, workspace_id FROM workspace_group_mappings ORDER BY workspace_id, id",
  );
  for (const row of groupMappings) {
    const workspace = workspaceById.get(String(row.workspace_id));
    if (!workspace) {
      problems.push(`workspace_group_mapping ${String(row.id)} references unknown workspace ${String(row.workspace_id)}.`);
    } else if (String(workspace.workspace_type) === "PERSONAL") {
      problems.push(
        `workspace_group_mapping ${String(row.id)} is attached to PERSONAL workspace ${String(row.workspace_id)}; group mappings are TEAM-only (spec §8.4).`,
      );
    }
  }

  const auditActors = await connection.query<{ actor_user_id: unknown }[]>(
    "SELECT actor_user_id FROM workspace_audit_events WHERE actor_user_id IS NOT NULL",
  );
  for (const row of auditActors) {
    if (!userIds.has(String(row.actor_user_id))) {
      problems.push(`a workspace_audit_event references unknown user ${String(row.actor_user_id)} in actor_user_id.`);
      break;
    }
  }

  if (problems.length > 0) refuse(problems);
}

export const phase3WorkspaceGovernanceFinalizeMigration: Migration = {
  version: 9,
  name: "phase-3-workspace-governance-finalize",
  statements: [
    "ALTER TABLE workspaces MODIFY workspace_type VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL",
    "ALTER TABLE workspace_memberships MODIFY role VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL",
    "ALTER TABLE workspace_memberships MODIFY membership_source VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL",
    "ALTER TABLE workspace_memberships ADD COLUMN created_by UUID NULL, ADD COLUMN updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)",
    "ALTER TABLE workspaces ADD CONSTRAINT ck_workspaces_workspace_type CHECK (workspace_type IN ('TEAM', 'PERSONAL'))",
    "ALTER TABLE workspaces ADD CONSTRAINT ck_workspaces_lifecycle_state CHECK (lifecycle_state IN ('ACTIVE', 'ARCHIVED'))",
    "ALTER TABLE workspaces ADD CONSTRAINT ck_workspaces_personal_shape CHECK (((workspace_type = 'TEAM') AND (personal_owner_user_id IS NULL)) OR ((workspace_type = 'PERSONAL') AND (personal_owner_user_id IS NOT NULL)))",
    "ALTER TABLE workspaces ADD CONSTRAINT ck_workspaces_personal_name CHECK ((workspace_type <> 'PERSONAL') OR (name = 'My Space'))",
    "ALTER TABLE workspace_memberships ADD CONSTRAINT ck_memberships_role CHECK (role IN ('OWNER', 'ADMIN', 'EDITOR', 'VIEWER'))",
    "ALTER TABLE workspace_memberships ADD CONSTRAINT ck_memberships_source CHECK (membership_source IN ('DIRECT', 'SYSTEM_PERSONAL'))",
    "ALTER TABLE workspace_memberships ADD CONSTRAINT ck_memberships_personal_source CHECK ((membership_source <> 'SYSTEM_PERSONAL') OR (role = 'OWNER'))",
    "ALTER TABLE workspace_audit_events ADD CONSTRAINT ck_audit_events_actor_kind CHECK (actor_kind IN ('USER', 'SYSTEM'))",
    "ALTER TABLE workspaces ADD CONSTRAINT fk_workspaces_personal_owner FOREIGN KEY (personal_owner_user_id) REFERENCES users(id) ON UPDATE RESTRICT ON DELETE RESTRICT",
    "ALTER TABLE workspaces ADD CONSTRAINT fk_workspaces_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON UPDATE RESTRICT ON DELETE RESTRICT",
    "ALTER TABLE workspaces ADD CONSTRAINT fk_workspaces_archived_by FOREIGN KEY (archived_by) REFERENCES users(id) ON UPDATE RESTRICT ON DELETE RESTRICT",
    "ALTER TABLE workspace_memberships ADD CONSTRAINT fk_memberships_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON UPDATE RESTRICT ON DELETE RESTRICT",
  ],
  beforeApply: async (connection) => {
    await assertGovernanceFinalizeReady(connection);
  },
};

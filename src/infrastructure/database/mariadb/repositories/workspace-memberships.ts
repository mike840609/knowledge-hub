import { IntegrityViolationError } from "@/modules/knowledge/domain/errors";
import type { WorkspaceMembership, WorkspaceMembershipInsert, WorkspaceMembershipSource, WorkspaceRole } from "@/modules/workspaces/domain/workspace-membership";
import type { WorkspaceMembershipRepository } from "@/modules/workspaces/ports/workspace-membership-repository";
import type { QueryConnection, DbRow } from "./shared";
import { asDate } from "./shared";

function asRole(value: unknown): WorkspaceRole | null {
  if (value === null || typeof value === "undefined") return null;
  if (value === "OWNER" || value === "ADMIN" || value === "EDITOR" || value === "VIEWER") return value;
  throw new IntegrityViolationError("Database returned an invalid membership role.");
}

function asMembershipSource(value: unknown): WorkspaceMembershipSource | null {
  if (value === null || typeof value === "undefined") return null;
  if (value === "DIRECT" || value === "SYSTEM_PERSONAL") return value;
  throw new IntegrityViolationError("Database returned an invalid membership_source.");
}

function mapMembership(row: DbRow): WorkspaceMembership {
  return {
    workspaceId: String(row.workspace_id),
    userId: String(row.user_id),
    createdAt: asDate(row.created_at),
    role: asRole(row.role),
    membershipSource: asMembershipSource(row.membership_source),
  };
}

export class MariaDbWorkspaceMembershipRepository implements WorkspaceMembershipRepository {
  constructor(private readonly connection: QueryConnection) {}

  async find(workspaceId: string, userId: string): Promise<WorkspaceMembership | null> {
    const rows = await this.connection.query<DbRow[]>("SELECT * FROM workspace_memberships WHERE workspace_id = ? AND user_id = ?", [workspaceId, userId]);
    return rows[0] ? mapMembership(rows[0]) : null;
  }

  async insert(membership: WorkspaceMembershipInsert): Promise<void> {
    if (membership.role !== "OWNER" && membership.role !== "ADMIN" && membership.role !== "EDITOR" && membership.role !== "VIEWER") {
      throw new IntegrityViolationError("Membership insert requires an explicit role.");
    }
    if (membership.membershipSource !== "DIRECT" && membership.membershipSource !== "SYSTEM_PERSONAL") {
      throw new IntegrityViolationError("Membership insert requires an explicit membershipSource.");
    }
    await this.connection.query(
      "INSERT INTO workspace_memberships (workspace_id, user_id, role, membership_source, created_at) VALUES (?, ?, ?, ?, ?)",
      [membership.workspaceId, membership.userId, membership.role, membership.membershipSource, membership.createdAt],
    );
  }

  async countDirectOwners(workspaceId: string): Promise<number> {
    const rows = await this.connection.query<{ count: number | bigint }[]>(
      "SELECT COUNT(*) AS count FROM workspace_memberships WHERE workspace_id = ? AND role = 'OWNER' AND membership_source = 'DIRECT'",
      [workspaceId],
    );
    return Number(rows[0]?.count ?? 0);
  }

  async updateRole(workspaceId: string, userId: string, role: WorkspaceRole): Promise<void> {
    if (role !== "OWNER" && role !== "ADMIN" && role !== "EDITOR" && role !== "VIEWER") {
      throw new IntegrityViolationError("Membership role update requires an explicit role.");
    }
    await this.connection.query("UPDATE workspace_memberships SET role = ? WHERE workspace_id = ? AND user_id = ?", [
      role,
      workspaceId,
      userId,
    ]);
  }
}

import type { WorkspaceMembership } from "@/modules/workspaces/domain/workspace-membership";
import type { WorkspaceMembershipRepository } from "@/modules/workspaces/ports/workspace-membership-repository";
import type { QueryConnection, DbRow } from "./shared";
import { asDate } from "./shared";

function mapMembership(row: DbRow): WorkspaceMembership {
  return { workspaceId: String(row.workspace_id), userId: String(row.user_id), createdAt: asDate(row.created_at) };
}

export class MariaDbWorkspaceMembershipRepository implements WorkspaceMembershipRepository {
  constructor(private readonly connection: QueryConnection) {}

  async find(workspaceId: string, userId: string): Promise<WorkspaceMembership | null> {
    const rows = await this.connection.query<DbRow[]>("SELECT * FROM workspace_memberships WHERE workspace_id = ? AND user_id = ?", [workspaceId, userId]);
    return rows[0] ? mapMembership(rows[0]) : null;
  }

  async insert(membership: WorkspaceMembership): Promise<void> {
    await this.connection.query("INSERT INTO workspace_memberships (workspace_id, user_id, created_at) VALUES (?, ?, ?)", [membership.workspaceId, membership.userId, membership.createdAt]);
  }
}

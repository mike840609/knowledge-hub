import type { Workspace } from "@/modules/workspaces/domain/workspace";
import type { WorkspaceRepository } from "@/modules/workspaces/ports/workspace-repository";
import type { QueryConnection, DbRow } from "./shared";
import { asDate } from "./shared";

function mapWorkspace(row: DbRow): Workspace {
  return { id: String(row.id), name: String(row.name), createdAt: asDate(row.created_at), updatedAt: asDate(row.updated_at) };
}

export class MariaDbWorkspaceRepository implements WorkspaceRepository {
  constructor(private readonly connection: QueryConnection) {}

  async findById(workspaceId: string): Promise<Workspace | null> {
    const rows = await this.connection.query<DbRow[]>("SELECT * FROM workspaces WHERE id = ?", [workspaceId]);
    return rows[0] ? mapWorkspace(rows[0]) : null;
  }

  async listForUser(userId: string): Promise<Workspace[]> {
    const rows = await this.connection.query<DbRow[]>(
      "SELECT w.* FROM workspaces w INNER JOIN workspace_memberships m ON m.workspace_id = w.id WHERE m.user_id = ? ORDER BY w.name, w.id",
      [userId],
    );
    return rows.map(mapWorkspace);
  }

  async insert(workspace: Workspace): Promise<void> {
    await this.connection.query("INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)", [workspace.id, workspace.name, workspace.createdAt, workspace.updatedAt]);
  }
}

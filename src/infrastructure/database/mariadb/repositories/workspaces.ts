import { IntegrityViolationError } from "@/modules/knowledge/domain/errors";
import type { Workspace, WorkspaceInsert, WorkspaceLifecycleState, WorkspaceType } from "@/modules/workspaces/domain/workspace";
import type { WorkspaceRepository } from "@/modules/workspaces/ports/workspace-repository";
import type { QueryConnection, DbRow } from "./shared";
import { asDate, asNullableDate } from "./shared";

function asWorkspaceType(value: unknown): WorkspaceType | null {
  if (value === null || typeof value === "undefined") return null;
  if (value === "PERSONAL" || value === "TEAM") return value;
  throw new IntegrityViolationError("Database returned an invalid workspace_type.");
}

function asLifecycleState(value: unknown): WorkspaceLifecycleState | null {
  if (value === null || typeof value === "undefined") return null;
  if (value === "ACTIVE" || value === "ARCHIVED") return value;
  throw new IntegrityViolationError("Database returned an invalid lifecycle_state.");
}

function asNullableId(value: unknown): string | null {
  if (value === null || typeof value === "undefined") return null;
  return String(value);
}

function mapWorkspace(row: DbRow): Workspace {
  return {
    id: String(row.id),
    name: String(row.name),
    createdAt: asDate(row.created_at),
    updatedAt: asDate(row.updated_at),
    workspaceType: asWorkspaceType(row.workspace_type),
    personalOwnerUserId: asNullableId(row.personal_owner_user_id),
    lifecycleState: asLifecycleState(row.lifecycle_state),
    createdBy: asNullableId(row.created_by),
    archivedBy: asNullableId(row.archived_by),
    archivedAt: asNullableDate(row.archived_at),
  };
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

  async lockById(workspaceId: string): Promise<Workspace | null> {
    const rows = await this.connection.query<DbRow[]>("SELECT * FROM workspaces WHERE id = ? FOR UPDATE", [workspaceId]);
    return rows[0] ? mapWorkspace(rows[0]) : null;
  }

  async insert(workspace: WorkspaceInsert): Promise<void> {
    if (workspace.workspaceType !== "PERSONAL" && workspace.workspaceType !== "TEAM") {
      throw new IntegrityViolationError("Workspace insert requires an explicit workspaceType.");
    }
    if (workspace.lifecycleState !== "ACTIVE" && workspace.lifecycleState !== "ARCHIVED") {
      throw new IntegrityViolationError("Workspace insert requires an explicit lifecycleState.");
    }
    await this.connection.query(
      `INSERT INTO workspaces (id, name, workspace_type, personal_owner_user_id, lifecycle_state, created_by, archived_by, archived_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        workspace.id, workspace.name, workspace.workspaceType, workspace.personalOwnerUserId,
        workspace.lifecycleState, workspace.createdBy, workspace.archivedBy, workspace.archivedAt,
        workspace.createdAt, workspace.updatedAt,
      ],
    );
  }
}

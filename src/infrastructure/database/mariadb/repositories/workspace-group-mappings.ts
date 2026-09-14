import { IntegrityViolationError } from "@/modules/knowledge/domain/errors";
import type { WorkspaceGroupMapping, WorkspaceGroupRole } from "@/modules/workspaces/domain/workspace-group-mapping";
import type { WorkspaceGroupMappingRepository } from "@/modules/workspaces/ports/workspace-group-mapping-repository";
import type { DbRow, QueryConnection } from "./shared";
import { asDate, asRequiredString } from "./shared";

function asGroupId(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) return Buffer.from(value).toString("utf8");
  throw new IntegrityViolationError("Database returned an invalid external group id.");
}

function asGroupRole(value: unknown): WorkspaceGroupRole {
  if (value === "ADMIN" || value === "EDITOR" || value === "VIEWER") return value;
  throw new IntegrityViolationError("Database returned an invalid group mapping role.");
}

function mapGroupMapping(row: DbRow): WorkspaceGroupMapping {
  return {
    id: asRequiredString(row.id, "group mapping id"),
    workspaceId: asRequiredString(row.workspace_id, "group mapping workspace"),
    externalGroupId: asGroupId(row.external_group_id),
    role: asGroupRole(row.role),
    createdBy: row.created_by === null || typeof row.created_by === "undefined" ? null : String(row.created_by),
    createdAt: asDate(row.created_at),
    updatedAt: asDate(row.updated_at),
  };
}

function toGroupBytes(externalGroupId: string): Buffer {
  return Buffer.from(externalGroupId, "utf8");
}

export class MariaDbWorkspaceGroupMappingRepository implements WorkspaceGroupMappingRepository {
  constructor(private readonly connection: QueryConnection) {}

  async findExact(workspaceId: string, externalGroupId: string): Promise<WorkspaceGroupMapping | null> {
    const rows = await this.connection.query<DbRow[]>(
      "SELECT * FROM workspace_group_mappings WHERE workspace_id = ? AND external_group_id = ?",
      [workspaceId, toGroupBytes(externalGroupId)],
    );
    return rows[0] ? mapGroupMapping(rows[0]) : null;
  }

  async listByWorkspace(workspaceId: string): Promise<WorkspaceGroupMapping[]> {
    const rows = await this.connection.query<DbRow[]>(
      "SELECT * FROM workspace_group_mappings WHERE workspace_id = ? ORDER BY created_at, id",
      [workspaceId],
    );
    return rows.map(mapGroupMapping);
  }

  async listByExternalGroupIds(externalGroupIds: readonly string[]): Promise<WorkspaceGroupMapping[]> {
    if (externalGroupIds.length === 0) return [];
    const placeholders = externalGroupIds.map(() => "?").join(", ");
    const rows = await this.connection.query<DbRow[]>(
      `SELECT * FROM workspace_group_mappings WHERE external_group_id IN (${placeholders}) ORDER BY created_at, id`,
      externalGroupIds.map(toGroupBytes),
    );
    return rows.map(mapGroupMapping);
  }

  async updateRole(id: string, role: WorkspaceGroupRole): Promise<void> {
    if (role !== "ADMIN" && role !== "EDITOR" && role !== "VIEWER") {
      throw new IntegrityViolationError("Group mapping role update requires an ADMIN, EDITOR, or VIEWER role.");
    }
    await this.connection.query("UPDATE workspace_group_mappings SET role = ?, updated_at = ? WHERE id = ?", [
      role,
      new Date(),
      id,
    ]);
  }

  async remove(id: string): Promise<void> {
    await this.connection.query("DELETE FROM workspace_group_mappings WHERE id = ?", [id]);
  }

  async insert(mapping: WorkspaceGroupMapping): Promise<void> {
    if (mapping.role !== "ADMIN" && mapping.role !== "EDITOR" && mapping.role !== "VIEWER") {
      throw new IntegrityViolationError("Group mapping insert requires an ADMIN, EDITOR, or VIEWER role.");
    }
    await this.connection.query(
      `INSERT INTO workspace_group_mappings (id, workspace_id, external_group_id, role, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [mapping.id, mapping.workspaceId, toGroupBytes(mapping.externalGroupId), mapping.role, mapping.createdBy, mapping.createdAt, mapping.updatedAt],
    );
  }
}

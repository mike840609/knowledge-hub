import { IntegrityViolationError, SourceNotFoundError } from "@/modules/knowledge/domain/errors";
import type { SourceOwnership, SourceType } from "@/modules/knowledge/domain/source-policy";
import type { KnowledgeSource } from "@/modules/sources/domain/source";
import type { SourceRepository } from "@/modules/sources/ports/source-repository";
import type { QueryConnection, DbRow } from "./shared";
import { affectedRows, asDate, asRequiredString } from "./shared";

function mapSource(row: DbRow): KnowledgeSource {
  return {
    id: String(row.id), name: String(row.name), workspaceId: String(row.workspace_id),
    sourceType: String(row.source_type) as SourceType, ownership: String(row.ownership) as SourceOwnership,
    status: String(row.status) as "ACTIVE" | "ARCHIVED", syncVersion: Number(row.sync_version),
    createdBy: String(row.created_by), updatedBy: asRequiredString(row.updated_by, "source updated_by"),
    archivedBy: row.archived_by === null ? null : String(row.archived_by),
    archivedAt: row.archived_at === null ? null : asDate(row.archived_at),
    createdAt: asDate(row.created_at), updatedAt: asDate(row.updated_at),
  };
}

export class MariaDbSourceRepository implements SourceRepository {
  constructor(private readonly connection: QueryConnection) {}

  async findById(sourceId: string): Promise<KnowledgeSource | null> {
    const rows = await this.connection.query<DbRow[]>("SELECT * FROM knowledge_sources WHERE id = ?", [sourceId]);
    return rows[0] ? mapSource(rows[0]) : null;
  }

  async findByWorkspaceId(workspaceId: string, options: { includeArchived?: boolean } = {}): Promise<KnowledgeSource[]> {
    const rows = options.includeArchived
      ? await this.connection.query<DbRow[]>("SELECT * FROM knowledge_sources WHERE workspace_id = ? ORDER BY name, id", [workspaceId])
      : await this.connection.query<DbRow[]>("SELECT * FROM knowledge_sources WHERE workspace_id = ? AND status = 'ACTIVE' ORDER BY name, id", [workspaceId]);
    return rows.map(mapSource);
  }

  async findActiveByWorkspaceId(workspaceId: string): Promise<KnowledgeSource[]> {
    return this.findByWorkspaceId(workspaceId, { includeArchived: false });
  }

  async lockById(sourceId: string): Promise<KnowledgeSource | null> {
    const rows = await this.connection.query<DbRow[]>("SELECT * FROM knowledge_sources WHERE id = ? FOR UPDATE", [sourceId]);
    return rows[0] ? mapSource(rows[0]) : null;
  }

  async insert(source: KnowledgeSource): Promise<void> {
    await this.connection.query(
      `INSERT INTO knowledge_sources (id, name, workspace_id, source_type, ownership, status, sync_version, created_by, updated_by, archived_by, archived_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [source.id, source.name, source.workspaceId, source.sourceType, source.ownership, source.status, source.syncVersion, source.createdBy, source.updatedBy, source.archivedBy, source.archivedAt, source.createdAt, source.updatedAt],
    );
  }

  async updateStatus(sourceId: string, status: "ACTIVE" | "ARCHIVED", actorId: string): Promise<void> {
    const archivedBy = status === "ARCHIVED" ? actorId : null;
    const archivedAt = status === "ARCHIVED" ? new Date() : null;
    const result = await this.connection.query(
      "UPDATE knowledge_sources SET status = ?, updated_by = ?, archived_by = ?, archived_at = ?, updated_at = CURRENT_TIMESTAMP(6) WHERE id = ?",
      [status, actorId, archivedBy, archivedAt, sourceId],
    );
    if (affectedRows(result) !== 1) throw new IntegrityViolationError("Source lifecycle could not be updated.");
  }

  async guardAndAdvanceVersion(sourceId: string, basedOnVersion: number, actorId: string): Promise<number | null> {
    const result = await this.connection.query(
      `UPDATE knowledge_sources
       SET sync_version = sync_version + 1, updated_by = ?, updated_at = CURRENT_TIMESTAMP(6)
       WHERE id = ? AND sync_version = ? AND source_type = 'FOLDER_SYNC'
         AND ownership = 'SOURCE_MANAGED' AND status = 'ACTIVE'`,
      [actorId, sourceId, basedOnVersion],
    );
    if (affectedRows(result) !== 1) return null;
    const source = await this.findById(sourceId);
    if (!source) throw new SourceNotFoundError("Knowledge source was not found after version guard.");
    return source.syncVersion;
  }
}

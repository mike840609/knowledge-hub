import type { SourceEntry, SourceEntryType } from "@/modules/sources/domain/source-entry";
import type { EntryRepository } from "@/modules/sources/ports/entry-repository";
import type { QueryConnection, DbRow } from "./shared";
import { asDate, asRequiredString } from "./shared";

function mapEntry(row: DbRow): SourceEntry {
  return {
    id: String(row.id), sourceId: String(row.source_id), externalId: row.external_id === null ? null : String(row.external_id),
    sourcePath: String(row.source_path), entryType: String(row.entry_type) as SourceEntryType,
    contentHash: row.content_hash === null ? null : String(row.content_hash), documentId: row.document_id === null ? null : String(row.document_id),
    status: String(row.status) as "ACTIVE" | "ARCHIVED", updatedBy: asRequiredString(row.updated_by, "source entry updated_by"),
    archivedBy: row.archived_by === null ? null : String(row.archived_by), archivedAt: row.archived_at === null ? null : asDate(row.archived_at),
    firstSeenAt: asDate(row.first_seen_at), lastSeenAt: asDate(row.last_seen_at),
  };
}

export class MariaDbEntryRepository implements EntryRepository {
  constructor(private readonly connection: QueryConnection) {}

  async findById(entryId: string): Promise<SourceEntry | null> {
    const rows = await this.connection.query<DbRow[]>("SELECT * FROM source_entries WHERE id = ?", [entryId]);
    return rows[0] ? mapEntry(rows[0]) : null;
  }

  async findByExternalId(sourceId: string, externalId: string): Promise<SourceEntry | null> {
    const rows = await this.connection.query<DbRow[]>("SELECT * FROM source_entries WHERE source_id = ? AND external_id = ?", [sourceId, externalId]);
    return rows[0] ? mapEntry(rows[0]) : null;
  }

  async insert(entry: SourceEntry): Promise<void> {
    await this.connection.query(
      `INSERT INTO source_entries (id, source_id, external_id, source_path, entry_type, content_hash, document_id, status, updated_by, archived_by, archived_at, first_seen_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [entry.id, entry.sourceId, entry.externalId, entry.sourcePath, entry.entryType, entry.contentHash, entry.documentId, entry.status, entry.updatedBy, entry.archivedBy, entry.archivedAt, entry.firstSeenAt, entry.lastSeenAt],
    );
  }

  async update(entry: SourceEntry): Promise<void> {
    await this.connection.query(
      `UPDATE source_entries SET external_id = ?, source_path = ?, entry_type = ?, content_hash = ?, document_id = ?, status = ?, updated_by = ?, archived_by = ?, archived_at = ?, last_seen_at = ? WHERE id = ?`,
      [entry.externalId, entry.sourcePath, entry.entryType, entry.contentHash, entry.documentId, entry.status, entry.updatedBy, entry.archivedBy, entry.archivedAt, entry.lastSeenAt, entry.id],
    );
  }
}

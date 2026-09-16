import type { ImportDiagnostic } from "@/modules/sources/domain/import-diagnostic";
import type { FinalizedImportSnapshotEntry, ImportSnapshotEntry } from "@/modules/sources/domain/import-snapshot";
import type { ImportSnapshotEntryRepository } from "@/modules/sources/ports/import-snapshot-entry-repository";
import type { DbRow, QueryConnection } from "./shared";
import { asNullableDate, asNumber } from "./shared";

function parsed<T>(value: unknown, fallback: T): T {
  if (value === null || typeof value === "undefined") return fallback;
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

function mapEntry(row: DbRow): ImportSnapshotEntry {
  return {
    id: String(row.id),
    snapshotId: String(row.snapshot_id),
    uploadKey: String(row.upload_key),
    clientRelativePath: String(row.client_relative_path),
    sourcePath: row.source_path === null ? null : String(row.source_path),
    sourcePathHash: row.source_path_hash === null ? null : String(row.source_path_hash),
    entryType: String(row.entry_type) as ImportSnapshotEntry["entryType"],
    uploadStatus: String(row.upload_status) as ImportSnapshotEntry["uploadStatus"],
    declaredSize: asNumber(row.declared_size, "declared_size"),
    sourceFileHash: row.source_file_hash === null ? null : String(row.source_file_hash),
    rawMarkdown: row.raw_markdown === null ? null : String(row.raw_markdown),
    resolvedTitle: row.resolved_title === null ? null : String(row.resolved_title),
    titleSource: row.title_source === null ? null : String(row.title_source) as ImportSnapshotEntry["titleSource"],
    markdown: row.markdown === null ? null : String(row.markdown),
    metadata: row.metadata === null ? null : parsed(row.metadata, {}),
    revisionContentHash: row.revision_content_hash === null ? null : String(row.revision_content_hash),
    reconciliationFingerprint: row.reconciliation_fingerprint === null ? null : String(row.reconciliation_fingerprint),
    mimeType: row.mime_type === null ? null : String(row.mime_type),
    assetContentHash: row.asset_content_hash === null ? null : String(row.asset_content_hash),
    assetSize: row.asset_size === null ? null : asNumber(row.asset_size, "asset_size"),
    assetLastModified: asNullableDate(row.asset_last_modified),
    diagnostics: parsed<ImportDiagnostic[]>(row.diagnostics, []),
    previewChange: row.preview_change === null ? null : parsed(row.preview_change, null),
  };
}

const INSERT_COLUMNS =
  "id,snapshot_id,upload_key,client_relative_path,source_path,source_path_hash,entry_type,upload_status,declared_size," +
  "source_file_hash,raw_markdown,resolved_title,title_source,markdown,metadata,revision_content_hash,reconciliation_fingerprint," +
  "mime_type,asset_content_hash,asset_size,asset_last_modified,diagnostics,preview_change";
const ROW_PLACEHOLDERS = "(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)";

/**
 * Item 17b: `raw_markdown` admits rows up to 5 MiB, so pure row-count
 * chunking could still blow `max_allowed_packet`. Chunks accumulate until
 * either cap is hit; a single row past the solo threshold goes out alone so
 * it fails naturally at the server (existing 1406 mapping) instead of
 * poisoning a whole chunk.
 */
const MAX_CHUNK_ROWS = 1000;
const MAX_CHUNK_BYTES = 4 * 1024 * 1024;
const SOLO_ROW_BYTES = 8 * 1024 * 1024;

function toRowArgs(entry: ImportSnapshotEntry): unknown[] {
  return [
    entry.id, entry.snapshotId, entry.uploadKey, entry.clientRelativePath, entry.sourcePath, entry.sourcePathHash,
    entry.entryType, entry.uploadStatus, entry.declaredSize, entry.sourceFileHash, entry.rawMarkdown, entry.resolvedTitle,
    entry.titleSource, entry.markdown, entry.metadata === null ? null : JSON.stringify(entry.metadata), entry.revisionContentHash,
    entry.reconciliationFingerprint, entry.mimeType, entry.assetContentHash, entry.assetSize, entry.assetLastModified,
    JSON.stringify(entry.diagnostics), entry.previewChange === null ? null : JSON.stringify(entry.previewChange),
  ];
}

function estimatedBytes(args: unknown[]): number {
  let total = 0;
  for (const arg of args) {
    if (typeof arg === "string") total += arg.length;
    else if (typeof arg === "number") total += 8;
    else if (arg instanceof Date) total += 24;
  }
  return total;
}

export class MariaDbImportSnapshotEntryRepository implements ImportSnapshotEntryRepository {
  constructor(private readonly connection: QueryConnection) {}

  async insertMany(entries: ImportSnapshotEntry[]): Promise<void> {
    if (entries.length === 0) return;
    let chunk: unknown[][] = [];
    let chunkBytes = 0;
    const flush = async (): Promise<void> => {
      if (chunk.length === 0) return;
      const placeholders = chunk.map(() => ROW_PLACEHOLDERS).join(",");
      await this.connection.query(
        `INSERT INTO source_import_snapshot_entries (${INSERT_COLUMNS}) VALUES ${placeholders}`,
        chunk.flat(),
      );
      chunk = [];
      chunkBytes = 0;
    };
    for (const entry of entries) {
      const args = toRowArgs(entry);
      const size = estimatedBytes(args);
      if (size > SOLO_ROW_BYTES) {
        await flush();
        await this.connection.query(
          `INSERT INTO source_import_snapshot_entries (${INSERT_COLUMNS}) VALUES ${ROW_PLACEHOLDERS}`,
          args,
        );
        continue;
      }
      if (chunk.length >= MAX_CHUNK_ROWS || (chunk.length > 0 && chunkBytes + size > MAX_CHUNK_BYTES)) {
        await flush();
      }
      chunk.push(args);
      chunkBytes += size;
    }
    await flush();
  }

  async listBySnapshotId(snapshotId: string): Promise<ImportSnapshotEntry[]> {
    const rows = await this.connection.query<DbRow[]>(
      "SELECT * FROM source_import_snapshot_entries WHERE snapshot_id=? ORDER BY client_relative_path, upload_key",
      [snapshotId],
    );
    return rows.map(mapEntry);
  }

  async findByUploadKey(snapshotId: string, uploadKey: string): Promise<ImportSnapshotEntry | null> {
    const rows = await this.connection.query<DbRow[]>(
      "SELECT * FROM source_import_snapshot_entries WHERE snapshot_id=? AND upload_key=?",
      [snapshotId, uploadKey],
    );
    return rows[0] ? mapEntry(rows[0]) : null;
  }

  async markMarkdownReceived(input: { entryId: string; rawMarkdown: string | null; sourceFileHash: string; diagnostics: ImportDiagnostic[] }): Promise<void> {
    await this.connection.query(
      "UPDATE source_import_snapshot_entries SET upload_status='RECEIVED', raw_markdown=?, source_file_hash=?, diagnostics=? WHERE id=?",
      [input.rawMarkdown, input.sourceFileHash, JSON.stringify(input.diagnostics), input.entryId],
    );
  }

  async replaceFinalizedEntries(snapshotId: string, entries: FinalizedImportSnapshotEntry[]): Promise<void> {
    await this.connection.query("DELETE FROM source_import_snapshot_entries WHERE snapshot_id=?", [snapshotId]);
    await this.insertMany(entries);
  }
}

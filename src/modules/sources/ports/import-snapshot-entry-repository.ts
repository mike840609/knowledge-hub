import type { ImportDiagnostic } from "../domain/import-diagnostic";
import type { FinalizedImportSnapshotEntry, ImportSnapshotEntry } from "../domain/import-snapshot";

export interface ImportSnapshotEntryRepository {
  insertMany(entries: ImportSnapshotEntry[]): Promise<void>;
  listBySnapshotId(snapshotId: string): Promise<ImportSnapshotEntry[]>;
  /** Declared bytes of the snapshot's Markdown entries: what finalize and Apply will load. */
  markdownBytes(snapshotId: string): Promise<number>;
  findByUploadKey(snapshotId: string, uploadKey: string): Promise<ImportSnapshotEntry | null>;
  markMarkdownReceived(input: { entryId: string; rawMarkdown: string | null; sourceFileHash: string; diagnostics: ImportDiagnostic[] }): Promise<void>;
  /** A verified image upload: the entry is received and its bytes are proven to match `contentHash`. */
  markAssetReceived(entryId: string, contentHash: string): Promise<void>;
  replaceFinalizedEntries(snapshotId: string, entries: FinalizedImportSnapshotEntry[]): Promise<void>;
}

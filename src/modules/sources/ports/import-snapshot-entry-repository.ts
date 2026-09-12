import type { ImportDiagnostic } from "../domain/import-diagnostic";
import type { FinalizedImportSnapshotEntry, ImportSnapshotEntry } from "../domain/import-snapshot";

export interface ImportSnapshotEntryRepository {
  insertMany(entries: ImportSnapshotEntry[]): Promise<void>;
  listBySnapshotId(snapshotId: string): Promise<ImportSnapshotEntry[]>;
  findByUploadKey(snapshotId: string, uploadKey: string): Promise<ImportSnapshotEntry | null>;
  markMarkdownReceived(input: { entryId: string; rawMarkdown: string | null; sourceFileHash: string; diagnostics: ImportDiagnostic[] }): Promise<void>;
  replaceFinalizedEntries(snapshotId: string, entries: FinalizedImportSnapshotEntry[]): Promise<void>;
}

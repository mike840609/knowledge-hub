import type { CallerContext } from "@/modules/identity/domain/caller-context";
import { decodeUtf8Markdown, sourceFileHash } from "@/modules/sources/adapters/generic-markdown-folder-adapter";
import type { ImportDiagnostic } from "@/modules/sources/domain/import-diagnostic";
import { importError, SourceImportError } from "@/modules/sources/domain/import-errors";
import { DEFAULT_IMPORT_LIMITS, type ImportLimits } from "@/modules/sources/domain/import-limits";
import type { SourceUnitOfWork } from "@/modules/sources/ports/unit-of-work";

export type UploadImportResult = { accepted: number; idempotent: number; diagnostics: ImportDiagnostic[] };
type Options = { limits?: ImportLimits; now?: () => Date };

export class UploadFolderImportEntriesService {
  private readonly limits: ImportLimits;
  private readonly now: () => Date;

  constructor(private readonly uow: SourceUnitOfWork, options: Options = {}) {
    this.limits = options.limits ?? DEFAULT_IMPORT_LIMITS;
    this.now = options.now ?? (() => new Date());
  }

  async upload(caller: CallerContext, input: { snapshotId: string; entries: { uploadKey: string; bytes: Uint8Array }[] }): Promise<UploadImportResult> {
    if (!Array.isArray(input.entries) || input.entries.length === 0 || input.entries.length > this.limits.maxUploadBatchFiles) {
      throw importError("IMPORT_LIMIT_EXCEEDED", `Upload batch must contain between 1 and ${this.limits.maxUploadBatchFiles} files.`);
    }
    const seen = new Set<string>();
    let total = 0;
    for (const entry of input.entries) {
      if (!entry || typeof entry.uploadKey !== "string" || !entry.uploadKey || seen.has(entry.uploadKey) || !(entry.bytes instanceof Uint8Array)) {
        throw importError("INVALID_UPLOAD_BATCH", "Upload batch entries require unique upload keys and byte payloads.");
      }
      seen.add(entry.uploadKey);
      total += entry.bytes.byteLength;
      if (entry.bytes.byteLength > this.limits.maxMarkdownFileBytes || total > this.limits.maxUploadBatchBytes) {
        throw importError("IMPORT_LIMIT_EXCEEDED", "Upload batch exceeds the configured byte limits.");
      }
    }

    const now = this.now();
    return this.uow.run(async (repositories) => {
      const snapshot = await repositories.importSnapshots.lockById(input.snapshotId);
      if (!snapshot || snapshot.createdBy !== caller.identity.id) {
        throw importError("IMPORT_SNAPSHOT_NOT_FOUND", "Import snapshot was not found.");
      }
      await repositories.workspaceAccess.requireMembership(caller, snapshot.workspaceId);
      if (snapshot.state !== "BUILDING") throw importError("IMPORT_SNAPSHOT_NOT_BUILDING", "Only BUILDING snapshots accept uploads.");
      if (snapshot.expiresAt.getTime() <= now.getTime()) throw importError("IMPORT_SNAPSHOT_EXPIRED", "Import snapshot has expired.");

      let accepted = 0;
      let idempotent = 0;
      const diagnostics: ImportDiagnostic[] = [];
      for (const incoming of input.entries) {
        const staged = await repositories.importSnapshotEntries.findByUploadKey(snapshot.id, incoming.uploadKey);
        if (!staged || staged.entryType !== "DOCUMENT") throw importError("UPLOAD_ENTRY_NOT_FOUND", "Upload key does not identify a Markdown manifest entry.");
        const hash = sourceFileHash(incoming.bytes);
        if (staged.uploadStatus === "RECEIVED") {
          if (staged.sourceFileHash === hash) {
            idempotent += 1;
            continue;
          }
          throw importError("UPLOAD_ENTRY_CONFLICT", "An already-received upload key cannot be replaced with different bytes.");
        }
        if (incoming.bytes.byteLength !== staged.declaredSize) {
          throw importError("UPLOAD_SIZE_MISMATCH", "Uploaded Markdown size does not match the manifest declaration.");
        }
        let rawMarkdown: string | null = null;
        let entryDiagnostics: ImportDiagnostic[] = [];
        try {
          rawMarkdown = decodeUtf8Markdown(incoming.bytes);
        } catch (error) {
          if (!(error instanceof SourceImportError) || error.code !== "INVALID_MARKDOWN_ENCODING") throw error;
          entryDiagnostics = [{
            code: "INVALID_MARKDOWN_ENCODING", severity: "BLOCKING", sourcePath: staged.clientRelativePath,
            message: "Markdown must be valid UTF-8 or UTF-8 with BOM.",
          }];
        }
        await repositories.importSnapshotEntries.markMarkdownReceived({ entryId: staged.id, rawMarkdown, sourceFileHash: hash, diagnostics: entryDiagnostics });
        accepted += 1;
        diagnostics.push(...entryDiagnostics);
      }
      return { accepted, idempotent, diagnostics };
    });
  }
}
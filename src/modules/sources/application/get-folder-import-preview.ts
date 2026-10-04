import type { CallerContext } from "@/modules/identity/domain/caller-context";
import { importError } from "@/modules/sources/domain/import-errors";
import type { SourceUnitOfWork } from "@/modules/sources/ports/unit-of-work";
import { requireKnownSnapshotWorkspaceAccess, requireKnownSnapshotWorkspaceRead } from "./import-snapshot-access";
import { previewFromSnapshot, resolveImportPreviewNames, type ImportPreview } from "./reconcile-import-snapshot";

export type { ImportPreview } from "./reconcile-import-snapshot";

type Options = { now?: () => Date };

export class GetFolderImportPreviewService {
  private readonly now: () => Date;

  constructor(private readonly uow: SourceUnitOfWork, options: Options = {}) {
    this.now = options.now ?? (() => new Date());
  }

  async getContentDiff(caller: CallerContext, snapshotId: string, sourcePath: string) {
    return this.uow.run(async repositories => {
      const snapshot = await repositories.importSnapshots.findById(snapshotId);
      if (!snapshot || snapshot.createdBy !== caller.identity.id) throw importError("IMPORT_SNAPSHOT_NOT_FOUND", "Import snapshot was not found.");
      await requireKnownSnapshotWorkspaceRead(repositories.workspaceAccess, caller, snapshot.workspaceId);
      if (snapshot.state === "STALE") throw importError("IMPORT_SNAPSHOT_STALE", "Generate a fresh Preview before comparing changes.");
      if (snapshot.state !== "READY") throw importError("IMPORT_SNAPSHOT_NOT_READY", "Only a ready Preview can be compared.");
      if (snapshot.expiresAt.getTime() <= this.now().getTime()) throw importError("IMPORT_SNAPSHOT_EXPIRED", "Preview expired. Generate a new Preview.");
      if (!snapshot.plan || snapshot.plan.planVersion !== "phase2:v2") throw importError("IMPORT_PLAN_VERSION_UNSUPPORTED", "Generate a new Preview.");
      const locator = snapshot.plan.documents.updateLocator.find(entry => entry.sourcePath === sourcePath);
      const action = locator ? snapshot.plan.documents.revise.find(revision => revision.entryId === locator.entryId) : null;
      if (action) {
        if (!("uploadKey" in action.content)) throw importError("IMPORT_PLAN_VERSION_UNSUPPORTED", "Generate a new Preview.");
        const entry = await repositories.importSnapshotEntries.findByUploadKey(snapshotId, action.content.uploadKey);
        if (!entry || entry.sourcePath !== sourcePath) throw importError("IMPORT_SNAPSHOT_INVALID", "Preview content is unavailable. Generate a new Preview.");
        const before = await repositories.revisions.findById(action.expectedCurrentRevisionId);
        if (!before || before.documentId !== action.documentId || entry.markdown === null || entry.revisionContentHash !== action.content.contentHash) throw importError("IMPORT_SNAPSHOT_INVALID", "Preview content is unavailable. Generate a new Preview.");
        return { sourcePath, before: { title: before.title, markdown: before.markdown }, after: { title: action.content.title, markdown: entry.markdown } };
      }
      throw importError("UPLOAD_ENTRY_NOT_FOUND", "No updated document at this path in the Preview.");
    });
  }

  async get(caller: CallerContext, snapshotId: string): Promise<ImportPreview> {
    const now = this.now();
    return this.uow.run(async (repositories) => {
      const snapshot = await repositories.importSnapshots.findById(snapshotId);
      if (!snapshot || snapshot.createdBy !== caller.identity.id) {
        throw importError("IMPORT_SNAPSHOT_NOT_FOUND", "Import snapshot was not found.");
      }
      await requireKnownSnapshotWorkspaceAccess(repositories.workspaceAccess, caller, snapshot.workspaceId);
      return resolveImportPreviewNames(repositories, previewFromSnapshot(snapshot, now));
    });
  }
}

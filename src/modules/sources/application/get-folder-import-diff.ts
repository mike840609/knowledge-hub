import type { CallerContext } from "@/modules/identity/domain/caller-context";
import type { SourceUnitOfWork } from "../ports/unit-of-work";
import type { RevisionPayload, RevisionReference } from "../domain/import-plan";
import {
  buildImportContentDiff,
  type ImportPreviewContentDiff,
} from "../domain/import-content-diff";
import { importError } from "../domain/import-errors";
import { requireKnownSnapshotWorkspaceRead } from "./import-snapshot-access";
export class GetFolderImportDiffService {
  constructor(private readonly uow: SourceUnitOfWork) {}
  async get(
    caller: CallerContext,
    snapshotId: string,
    sourcePath: string,
  ): Promise<ImportPreviewContentDiff> {
    return this.uow.run(async (r) => {
      const snapshot = await r.importSnapshots.findById(snapshotId);
      if (!snapshot || snapshot.createdBy !== caller.identity.id)
        throw importError(
          "IMPORT_SNAPSHOT_NOT_FOUND",
          "Import preview unavailable.",
        );
      await requireKnownSnapshotWorkspaceRead(
        r.workspaceAccess,
        caller,
        snapshot.workspaceId,
      );
      if (snapshot.expiresAt.getTime() <= Date.now())
        throw importError(
          "IMPORT_SNAPSHOT_EXPIRED",
          "This preview expired. Check for changes again.",
        );
      if (snapshot.state !== "READY" || !snapshot.plan)
        throw importError(
          "IMPORT_SNAPSHOT_NOT_READY",
          "Create a fresh preview to compare changes.",
        );
      if (snapshot.sourceId) {
        const source = await r.sources.findById(snapshot.sourceId);
        if (!source || source.workspaceId !== snapshot.workspaceId)
          throw importError("IMPORT_SOURCE_NOT_FOUND", "Source unavailable.");
        if (source.syncVersion !== snapshot.basedOnVersion)
          throw importError(
            "SOURCE_VERSION_CONFLICT",
            "The source changed. Check for changes again.",
          );
      }
      const change = snapshot.plan.preview.find(
        (c) => c.kind === "DOCUMENT" && c.sourcePath === sourcePath,
      );
      if (!change)
        throw importError(
          "UPLOAD_ENTRY_NOT_FOUND",
          "This article is not in the preview.",
        );
      const entry = snapshot.sourceId
        ? await r.entries.findBySourcePath(
            snapshot.sourceId,
            change.previousPath ?? sourcePath,
          )
        : null;
      const revisionAction = entry?.documentId
        ? snapshot.plan.documents.revise.find(
            (action) => action.documentId === entry.documentId,
          )
        : undefined;
      const previousId =
        revisionAction?.expectedCurrentRevisionId ??
        (entry?.documentId
          ? (await r.revisions.findCurrent(entry.documentId))?.id
          : null) ??
        null;
      const previous = previousId
        ? await r.revisions.findById(previousId)
        : null;
      const action =
        snapshot.plan.documents.create.find(
          (a) => a.sourcePath === sourcePath,
        ) ?? revisionAction;
      let incoming: RevisionPayload | null = null,
        uploadKey: string | null = null;
      if (action) {
        const content: RevisionPayload | RevisionReference = action.content;
        if ("markdown" in content) incoming = content;
        else {
          uploadKey = content.uploadKey;
          const staged = await r.importSnapshotEntries.findByUploadKey(
            snapshot.id,
            uploadKey,
          );
          if (
            !staged ||
            staged.entryType !== "DOCUMENT" ||
            staged.markdown === null ||
            staged.metadata === null ||
            staged.revisionContentHash !== content.contentHash
          )
            throw importError(
              "IMPORT_SNAPSHOT_INTEGRITY_MISMATCH",
              "The preview content is unavailable. Check again.",
            );
          incoming = {
            title: content.title,
            markdown: staged.markdown,
            metadata: content.metadata,
            contentHash: content.contentHash,
          };
        }
      } else if (!change.labels.includes("ARCHIVED") && previous)
        incoming = previous;
      return {
        ...buildImportContentDiff(previous, incoming),
        snapshotId,
        basedOnVersion: snapshot.basedOnVersion,
        beforeRevisionId: previous?.id ?? null,
        afterUploadKey: uploadKey,
        beforePath: entry?.sourcePath ?? null,
        afterPath: sourcePath,
      };
    });
  }
}

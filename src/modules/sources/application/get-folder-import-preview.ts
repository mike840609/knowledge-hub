import type { CallerContext } from "@/modules/identity/domain/caller-context";
import { importError } from "@/modules/sources/domain/import-errors";
import type { SourceUnitOfWork } from "@/modules/sources/ports/unit-of-work";
import { previewFromSnapshot, type ImportPreview } from "./reconcile-import-snapshot";

export type { ImportPreview } from "./reconcile-import-snapshot";

type Options = { now?: () => Date };

export class GetFolderImportPreviewService {
  private readonly now: () => Date;

  constructor(private readonly uow: SourceUnitOfWork, options: Options = {}) {
    this.now = options.now ?? (() => new Date());
  }

  async get(caller: CallerContext, snapshotId: string): Promise<ImportPreview> {
    const now = this.now();
    return this.uow.run(async (repositories) => {
      const snapshot = await repositories.importSnapshots.findById(snapshotId);
      if (!snapshot || snapshot.createdBy !== caller.identity.id) {
        throw importError("IMPORT_SNAPSHOT_NOT_FOUND", "Import snapshot was not found.");
      }
      await repositories.workspaceAccess.requireMembership(caller, snapshot.workspaceId);
      return previewFromSnapshot(snapshot, now);
    });
  }
}

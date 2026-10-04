import { safetyForPlan } from "./import-plan-safety";
import type { CallerContext } from "@/modules/identity/domain/caller-context";
import { importError } from "@/modules/sources/domain/import-errors";
import type { SourceUnitOfWork } from "@/modules/sources/ports/unit-of-work";
import { requireKnownSnapshotWorkspaceRead } from "./import-snapshot-access";
import { previewFromSnapshot, resolveImportPreviewNames, type ImportPreview } from "./reconcile-import-snapshot";

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
      await requireKnownSnapshotWorkspaceRead(repositories.workspaceAccess, caller, snapshot.workspaceId);
      const preview=await resolveImportPreviewNames(repositories, previewFromSnapshot(snapshot, now));
      if(snapshot.sourceId && snapshot.state==="READY"){
        const source=await repositories.sources.findById(snapshot.sourceId);
        if(source && source.syncVersion!==snapshot.basedOnVersion)return {...preview,state:"STALE"};
      }
      return {...preview,safety:snapshot.plan ? await safetyForPlan(repositories,snapshot.sourceId,snapshot.plan):undefined};
    });
  }
}

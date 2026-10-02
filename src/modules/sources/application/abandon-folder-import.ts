import type { CallerContext } from "@/modules/identity/domain/caller-context";
import type { SourceUnitOfWork } from "@/modules/sources/ports/unit-of-work";

export class AbandonFolderImportService {
  constructor(private readonly uow: SourceUnitOfWork) {}

  async abandon(caller: CallerContext, snapshotId: string): Promise<{ abandoned: boolean }> {
    // Abandoning creator-private staging is safe even after Workspace access was
    // revoked: it only removes this caller's BUILDING snapshot/entries and
    // never mutates canonical knowledge. The state predicate also protects a
    // READY snapshot when finalize committed but its HTTP response was lost.
    const abandoned = await this.uow.run((repositories) =>
      repositories.importSnapshots.deleteBuildingByIdForCreator(snapshotId, caller.identity.id),
    );
    return { abandoned };
  }
}

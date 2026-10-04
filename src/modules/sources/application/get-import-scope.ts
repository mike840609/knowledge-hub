import type { CallerContext } from "@/modules/identity/domain/caller-context";
import type { SourceUnitOfWork } from "../ports/unit-of-work";
import { importError } from "../domain/import-errors";
export class GetImportScopeService {
  constructor(private readonly uow: SourceUnitOfWork) {}
  async get(caller: CallerContext, sourceId: string) {
    return this.uow.run(async r => {
      const source = await r.sources.findById(sourceId);
      if (!source) throw importError("IMPORT_SOURCE_NOT_FOUND", "Source unavailable.");
      await r.workspaceAccess.requireWorkspaceRead(caller, source.workspaceId);
      if (source.status !== "ACTIVE" || source.sourceType !== "FOLDER_SYNC") throw importError("SOURCE_IMPORT_NOT_ALLOWED", "Source unavailable.");
      return { paths: source.excludedPaths ?? [], configured: source.excludedPaths != null, syncVersion: source.syncVersion };
    });
  }
}

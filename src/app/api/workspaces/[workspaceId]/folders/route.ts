import { SourceNotFoundError } from "@/modules/knowledge/domain/errors";
import { ensureDefaultHubSource } from "@/modules/sources/application/ensure-default-hub-source";
import { parseCreateFolderInput, requireRouteId } from "@/server/authoring-input";
import { workspaceHttp, type WorkspaceRouteContext } from "@/server/workspace-http";

/**
 * A folder in the workspace's Hub source (daily-driver spec §7.1). Without `sourceId` it is the
 * default source, as for a new document; with one, that source must be this workspace's — the
 * path says which workspace the caller means, and a source is found through it, not the other way
 * round. Whether the caller may write there is the service's question either way.
 */
export async function POST(request: Request, context: WorkspaceRouteContext) {
  return workspaceHttp(async (services, caller) => {
    const workspaceId = requireRouteId((await context.params).workspaceId, "the workspace");
    const input = parseCreateFolderInput(await request.json().catch(() => null));
    let sourceId: string;
    if (input.sourceId === null) {
      sourceId = await ensureDefaultHubSource(services.unitOfWork, caller, workspaceId);
    } else {
      // includeArchived: an archived source is the service's to refuse (409 SOURCE_ARCHIVED), not this lookup's to hide.
      const source = await services.queries.getSource(caller, input.sourceId, { includeArchived: true });
      if (source.workspaceId !== workspaceId) throw new SourceNotFoundError();
      sourceId = source.id;
    }
    const created = await services.hub.createFolder(caller, { sourceId, parentId: input.parentId, name: input.name });
    return { treeNodeId: created.treeNodeId, sourceId };
  }, 201);
}

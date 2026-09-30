import { parseRenameFolderInput, requireRouteId } from "@/server/authoring-input";
import { workspaceHttp } from "@/server/workspace-http";

type TreeNodeRouteContext = { params: Promise<{ nodeId: string }> };

/**
 * Renames a folder. Moving and reordering share this path and arrive with the move dialog
 * (daily-driver spec §7.1); until then a body without a `name` is a 400, not a no-op.
 */
export async function PATCH(request: Request, context: TreeNodeRouteContext) {
  return workspaceHttp(async (services, caller) => {
    const nodeId = requireRouteId((await context.params).nodeId, "the folder");
    const { name } = parseRenameFolderInput(await request.json().catch(() => null));
    await services.hub.renameFolder(caller, { nodeId, name });
  }, 204);
}

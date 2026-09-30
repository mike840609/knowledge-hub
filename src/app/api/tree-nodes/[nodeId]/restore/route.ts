import { requireRouteId } from "@/server/authoring-input";
import { workspaceHttp } from "@/server/workspace-http";

type TreeNodeRouteContext = { params: Promise<{ nodeId: string }> };

/** POST rather than DELETE or PUT: the folder is not removed or replaced, its lifecycle changes, and it changes back. Idempotent, as the service is. */
export async function POST(_request: Request, context: TreeNodeRouteContext) {
  return workspaceHttp(async (services, caller) => {
    const nodeId = requireRouteId((await context.params).nodeId, "the folder");
    await services.hub.restoreFolder(caller, nodeId);
  }, 204);
}

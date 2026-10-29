import { workspaceHttp, type WorkspaceRouteContext } from "@/server/workspace-http";

/** The My Space owner's folders with a link open now: what the tree marks (folder share spec §8). */
export async function GET(_request: Request, context: WorkspaceRouteContext) {
  return workspaceHttp(async (services, caller) => ({ folders: await services.shares.listOpenFolderLinks(caller, (await context.params).workspaceId) }));
}

import { workspaceHttp } from "@/server/workspace-http";

type RevokeRouteContext = { params: Promise<{ linkId: string }> };

/** POST rather than DELETE: nothing is deleted, the link is only revoked (share-link spec §9.4). */
export async function POST(_request: Request, context: RevokeRouteContext) {
  return workspaceHttp(async (services, caller) => {
    const { linkId } = await context.params;
    await services.shares.revoke(caller, linkId);
  }, 204);
}

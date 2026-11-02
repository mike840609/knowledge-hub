import { workspaceHttp } from "@/server/workspace-http";

type RecipientRouteContext = { params: Promise<{ linkId: string; userId: string }> };

export async function DELETE(_request: Request, context: RecipientRouteContext) {
  return workspaceHttp(async (services, caller) => {
    const { linkId, userId } = await context.params;
    await services.shares.removeRecipient(caller, linkId, userId);
  }, 204);
}

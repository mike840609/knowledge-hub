import { workspaceHttp } from "@/server/workspace-http";

type ProposalsRouteContext = { params: Promise<{ linkId: string }> };

/** The link's PENDING proposals; owner only. */
export async function GET(_request: Request, context: ProposalsRouteContext) {
  return workspaceHttp(async (services, caller) => {
    const { linkId } = await context.params;
    return { proposals: await services.shares.listProposals(caller, linkId) };
  });
}

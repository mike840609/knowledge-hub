import { workspaceHttp } from "@/server/workspace-http";

type ProposalDecisionRouteContext = { params: Promise<{ linkId: string; proposalId: string }> };

/** Owner only; repeating the same decision is a no-op, anything else answers not-found. */
export async function POST(_request: Request, context: ProposalDecisionRouteContext) {
  return workspaceHttp(async (services, caller) => {
    const { linkId, proposalId } = await context.params;
    await services.shares.approveProposal(caller, linkId, proposalId);
  }, 204);
}

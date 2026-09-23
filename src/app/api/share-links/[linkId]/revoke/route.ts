import { NextResponse } from "next/server";
import { applicationServices } from "@/server/composition";
import { toWorkspaceErrorResponse } from "@/server/http-error-response";

type RevokeRouteContext = { params: Promise<{ linkId: string }> };

/** POST rather than DELETE: nothing is deleted, the link is only revoked (share-link spec §9.4). */
export async function POST(_request: Request, context: RevokeRouteContext) {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const services = applicationServices();
    const { caller } = await services.establishTrustedCaller();
    const { linkId } = await context.params;
    await services.shares.revoke(caller, linkId);
    return new NextResponse(null, { status: 204, headers });
  } catch (error) {
    const mapped = toWorkspaceErrorResponse(error);
    return NextResponse.json(mapped.body, { status: mapped.status, headers });
  }
}

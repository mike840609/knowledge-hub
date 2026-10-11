import { NextResponse } from "next/server";
import { applicationServices } from "./composition";
import { toWorkspaceErrorResponse } from "./http-error-response";
import { assertReviewOrigin } from "./review-origin";
import type { CallerContext } from "@/modules/identity/domain/caller-context";
export async function savedShareHttp(request: Request, work: (services: ReturnType<typeof applicationServices>, caller: CallerContext) => Promise<unknown>, status = 200): Promise<Response> {
  try {
    if (request.method !== "GET") assertReviewOrigin(request);
    const services = applicationServices(), { caller } = await services.establishTrustedCaller();
    const result = await work(services,caller);
    return status === 204 ? new NextResponse(null,{status,headers:{"Cache-Control":"private, no-store"}}) : NextResponse.json(result,{status,headers:{"Cache-Control":"private, no-store"}});
  } catch (error) {
    const mapped=toWorkspaceErrorResponse(error);
    return NextResponse.json(mapped.body,{status:mapped.status,headers:{"Cache-Control":"private, no-store"}});
  }
}

import { NextResponse } from "next/server";
import { applicationServices, reviewReadService } from "./composition";
import { toWorkspaceErrorResponse } from "./http-error-response";
import { assertReviewOrigin } from "./review-origin";
import type { DocumentReviewService } from "@/modules/knowledge/application/document-review-service";
import type { CallerContext } from "@/modules/identity/domain/caller-context";
export async function reviewHttp(request: Request, operation: (service: DocumentReviewService, caller: CallerContext) => Promise<unknown>, status = 200): Promise<Response> {
  try {
    if (request.method !== "GET") assertReviewOrigin(request);
    const services = applicationServices();
    const { caller } = await services.establishTrustedCaller();
    const result = await operation(services.reviews, caller);
    return NextResponse.json(result, { status, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const mapped = toWorkspaceErrorResponse(error);
    return NextResponse.json(mapped.body, { status: mapped.status, headers: { "Cache-Control": "private, no-store" } });
  }
}
/** A live share token grants read access; identity is optional only here. */
export async function reviewReadHttp(request: Request, operation: (service: Pick<DocumentReviewService, "queryForLink">, caller: CallerContext | null) => Promise<unknown>): Promise<Response> {
  try {
    assertReviewOrigin(request);
    let caller: CallerContext | null = null;
    let reviews: Pick<DocumentReviewService, "queryForLink">;
    try {
      const services = applicationServices();
      caller = (await services.establishTrustedCaller()).caller;
      reviews = services.reviews;
    } catch (error) {
      const { AuthRequiredError, AuthUnavailableError } = await import("@/modules/identity/domain/identity-session-errors");
      if (!(error instanceof AuthRequiredError) && !(error instanceof AuthUnavailableError)) throw error;
      reviews = reviewReadService();
    }
    return NextResponse.json(await operation(reviews, caller), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const mapped = toWorkspaceErrorResponse(error);
    return NextResponse.json(mapped.body, { status: mapped.status, headers: { "Cache-Control": "private, no-store" } });
  }
}
/** Owner review keeps the existing workspace authentication/error boundary. */
export async function ownerReviewHttp(request: Request, operation:(service:DocumentReviewService,caller:CallerContext)=>Promise<unknown>):Promise<Response> {
  try {
    if(request.method!=="GET") assertReviewOrigin(request);
  } catch(error) {
    const mapped=toWorkspaceErrorResponse(error);
    return NextResponse.json(mapped.body,{status:mapped.status,headers:{"Cache-Control":"private, no-store"}});
  }
  const { workspaceHttp } = await import("./workspace-http");
  return workspaceHttp(async (services,caller)=>operation(services.reviews,caller));
}
export async function reviewBody(request:Request):Promise<Record<string,unknown>> {
  const { DomainError } = await import("@/shared/domain/errors");
  let value:unknown;try {value=await request.json();}catch {throw new DomainError("INVALID_REQUEST","Provide a valid JSON object.");}
  if(!value||typeof value!=="object"||Array.isArray(value))throw new DomainError("INVALID_REQUEST","Provide a JSON object.");
  return value as Record<string,unknown>;
}

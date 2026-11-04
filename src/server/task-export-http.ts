import { NextResponse } from "next/server";
import type { CallerContext } from "@/modules/identity/domain/caller-context";
import { DomainError } from "@/shared/domain/errors";
import { applicationServices } from "./composition";
import { toWorkspaceErrorResponse, type ApiErrorBody } from "./http-error-response";
import { assertReviewOrigin } from "./review-origin";

const NO_STORE = { "Cache-Control": "private, no-store" };

function taskExportError(error: unknown): { status: number; body: ApiErrorBody } | null {
  if (!(error instanceof DomainError)) return null;
  if (error.code === "TASK_EXPORT_BINDING_NOT_FOUND") return { status: 404, body: { error: { code: "NOT_FOUND", message: "The requested resource was not found." } } };
  if (error.code === "BINDING_REVOKED" || error.code === "TASK_EXPORT_SOURCE_INELIGIBLE") return { status: 409, body: { error: { code: error.code, message: error.message } } };
  return null;
}

/** Browser-authenticated task-export routes: trusted caller, same-origin writes, never cached (a token may be in the body). */
export async function taskExportHttp(
  request: Request,
  work: (services: ReturnType<typeof applicationServices>, caller: CallerContext) => Promise<unknown>,
  status = 200,
): Promise<Response> {
  try {
    if (request.method !== "GET") assertReviewOrigin(request);
    const services = applicationServices();
    const { caller } = await services.establishTrustedCaller();
    const result = await work(services, caller);
    if (status === 204) return new NextResponse(null, { status, headers: NO_STORE });
    return NextResponse.json(result, { status, headers: NO_STORE });
  } catch (error) {
    const mapped = taskExportError(error) ?? toWorkspaceErrorResponse(error);
    if (mapped.status === 500) console.error("Task export request failed.", error instanceof Error ? error.name : "UnknownError");
    return NextResponse.json(mapped.body, { status: mapped.status, headers: NO_STORE });
  }
}

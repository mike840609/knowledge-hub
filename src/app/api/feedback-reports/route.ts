// Request-bound private routes must bypass Next auto-mode Request proxies.
export const dynamic = "force-dynamic";
import { assertReviewOrigin } from "@/server/review-origin";
import { workspaceHttp } from "@/server/workspace-http";
import { DomainError } from "@/shared/domain/errors";
export async function POST(request: Request) {
  return workspaceHttp(async (services, caller) => {
    // The body is read without a Content-Type check, so a cross-site text/plain form could post it: require same origin.
    assertReviewOrigin(request);
    const body = await request.json().catch(() => { throw new DomainError("INVALID_REQUEST", "Provide a valid JSON object."); });
    return services.feedbackReports.submit(caller, body);
  }, 201);
}

/**
 * The Issues tab of "Report a problem" reads here. Reports are not
 * Workspace-scoped: the trusted caller and the filters are the whole query,
 * and there is deliberately no workspace id to pass.
 */
export async function GET(request: Request) {
  return workspaceHttp(async (services, caller) => {
    const params = new URL(request.url).searchParams;
    return services.feedbackIssues.list(caller, {
      status: params.get("status") ?? undefined,
      category: params.get("category") ?? undefined,
      mine: params.get("mine") ?? undefined,
      beforeAt: params.get("beforeAt") ?? undefined,
      beforeId: params.get("beforeId") ?? undefined,
    });
  });
}

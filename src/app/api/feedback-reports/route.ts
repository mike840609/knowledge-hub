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

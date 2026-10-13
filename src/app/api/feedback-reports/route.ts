// Request-bound private routes must bypass Next auto-mode Request proxies.
export const dynamic = "force-dynamic";
import { workspaceHttp } from "@/server/workspace-http";
import { DomainError } from "@/shared/domain/errors";
export async function POST(request: Request) {
  return workspaceHttp(async (services, caller) => {
    const body = await request.json().catch(() => { throw new DomainError("INVALID_REQUEST", "Provide a valid JSON object."); });
    return services.feedbackReports.submit(caller, body);
  }, 201);
}

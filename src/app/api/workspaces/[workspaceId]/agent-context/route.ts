import { workspaceHttp, type WorkspaceRouteContext } from "@/server/workspace-http";
import { DomainError } from "@/shared/domain/errors";
export async function POST(request: Request, context: WorkspaceRouteContext) {
  return workspaceHttp(async (s, caller) => {
    if (Number(request.headers.get("content-length") ?? 0) > 8192) throw new DomainError("INVALID_REQUEST", "Context selection is too large.");
    const text = await request.text();
    if (new TextEncoder().encode(text).length > 8192) throw new DomainError("INVALID_REQUEST", "Context selection is too large.");
    let body: unknown;
    try { body = JSON.parse(text); } catch { throw new DomainError("INVALID_REQUEST", "Provide a JSON selection."); }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new DomainError("INVALID_REQUEST", "Provide a JSON selection.");
    return s.agentContext.build(caller, (await context.params).workspaceId, (body as Record<string, unknown>).documentIds, new URL(request.url).origin);
  });
}

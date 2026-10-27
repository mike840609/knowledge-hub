import { workspaceHttp, type WorkspaceRouteContext } from "@/server/workspace-http";
import { DomainError } from "@/shared/domain/errors";
export async function GET(request: Request, context: WorkspaceRouteContext) {
  return workspaceHttp(async (s, c) => {
    const { workspaceId } = await context.params;
    const url = new URL(request.url);
    const view = url.searchParams.get("view");
    if (view === "favorites") return s.personal.listFavorites(c, workspaceId);
    if (view !== null) throw new DomainError("INVALID_REQUEST", "Unknown personal view.");
    const key = url.searchParams.get("key");
    return key ? s.personal.get(c, workspaceId, key) : s.personal.list(c, workspaceId);
  });
}
export async function PUT(request: Request, context: WorkspaceRouteContext) {
  return workspaceHttp(async (s, c) => {
    const { workspaceId } = await context.params;
    const body = await request.json().catch(() => null);
    return s.personal.put(c, workspaceId, typeof body?.key === "string" ? body.key : "invalid", body?.value, body?.version);
  });
}

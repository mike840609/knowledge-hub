import { workspaceHttp, type WorkspaceRouteContext } from "@/server/workspace-http";
export async function GET(request: Request, context: WorkspaceRouteContext) {
  return workspaceHttp(async (s, c) => {
    const { workspaceId } = await context.params;
    const key = new URL(request.url).searchParams.get("key");
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

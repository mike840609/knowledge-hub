import { workspaceHttp, type WorkspaceRouteContext } from "@/server/workspace-http";
export async function GET(request: Request, context: WorkspaceRouteContext) {
  const query = new URL(request.url).searchParams;
  return workspaceHttp(async (s, caller) => s.shares.listManagement(caller, (await context.params).workspaceId, { q: query.get("q") ?? undefined, status: query.get("status") ?? undefined, page: query.get("page") ?? undefined }));
}

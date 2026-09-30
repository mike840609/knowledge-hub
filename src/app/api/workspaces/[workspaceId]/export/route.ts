import { workspaceHttp, type WorkspaceRouteContext } from "@/server/workspace-http";
import { workspaceExport } from "@/server/knowledge-export";
export async function GET(_request: Request, context: WorkspaceRouteContext) {
  return workspaceHttp(async (s, c) => new Response(await workspaceExport(s.queries, c, (await context.params).workspaceId), { headers: { "Content-Type": "application/zip", "Content-Disposition": 'attachment; filename="my-space.zip"' } }));
}

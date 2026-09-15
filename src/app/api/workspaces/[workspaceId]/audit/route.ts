import { workspaceHttp, type WorkspaceRouteContext } from "@/server/workspace-http";
export async function GET(request: Request, context: WorkspaceRouteContext) { return workspaceHttp(async (s, c) => s.workspaceAdmin.listAudit(c, (await context.params).workspaceId, new URL(request.url).searchParams.get("cursor") ?? undefined)); }

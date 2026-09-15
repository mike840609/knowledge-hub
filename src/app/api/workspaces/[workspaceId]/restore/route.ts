import { workspaceHttp, type WorkspaceRouteContext } from "@/server/workspace-http";
export async function POST(_request: Request, context: WorkspaceRouteContext) { return workspaceHttp(async (s, c) => { const { workspaceId } = await context.params; await s.workspaceAdmin.workspaceState(c, workspaceId); return s.teams.restoreTeamWorkspace(c, workspaceId); }); }

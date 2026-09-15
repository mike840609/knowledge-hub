import { workspaceHttp, requestFields } from "@/server/workspace-http";
export async function GET() { return workspaceHttp((s, c) => s.workspaceAdmin.navigation(c)); }
export async function POST(request: Request) { return workspaceHttp(async (s, c) => { const body = await requestFields(request, ["name"]); return s.teams.createTeamWorkspace(c, { name: body.name! }); }, 201); }

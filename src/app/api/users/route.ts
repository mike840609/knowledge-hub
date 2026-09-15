import { workspaceHttp } from "@/server/workspace-http";
export async function GET(request: Request) { return workspaceHttp((s, c) => { const params = new URL(request.url).searchParams; return s.workspaceAdmin.searchUsers(c, params.get("query") ?? "", Number(params.get("limit") ?? 20)); }); }

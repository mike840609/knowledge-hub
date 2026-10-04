import { workspaceHttp } from "@/server/workspace-http";
export async function GET(_request: Request, context: { params: Promise<{ sourceId: string }> }) {
  return workspaceHttp(async (s, caller) => s.importScope.get(caller, (await context.params).sourceId));
}

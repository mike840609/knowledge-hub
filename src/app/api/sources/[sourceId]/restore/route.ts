import { workspaceHttp } from "@/server/workspace-http";
export async function POST(_request: Request, context: { params: Promise<{ sourceId: string }> }) {
  return workspaceHttp(async (services, caller) => {
    await services.sources.restoreSource(caller, (await context.params).sourceId);
  }, 204);
}

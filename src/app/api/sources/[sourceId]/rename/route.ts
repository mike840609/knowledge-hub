import { requestFields, workspaceHttp } from "@/server/workspace-http";

export async function POST(request: Request, context: { params: Promise<{ sourceId: string }> }) {
  return workspaceHttp(async (services, caller) => {
    const { name } = await requestFields(request, ["name"]);
    await services.sources.renameSource(caller, (await context.params).sourceId, name);
  }, 204);
}

// Request-bound private routes must bypass Next auto-mode Request proxies.
export const dynamic = "force-dynamic";
import { requestFields } from "@/server/workspace-http";
import { taskExportHttp } from "@/server/task-export-http";

type Context = { params: Promise<{ workspaceId: string }> };

export async function GET(request: Request, context: Context) {
  return taskExportHttp(request, async (s, caller) => ({ bindings: await s.taskExportBindings.list(caller, (await context.params).workspaceId) }));
}

/** The token in this response is shown once; only its hash is stored. */
export async function POST(request: Request, context: Context) {
  return taskExportHttp(request, async (s, caller) => {
    const { sourceId, label } = await requestFields(request, ["sourceId", "label"]);
    return s.taskExportBindings.create(caller, { workspaceId: (await context.params).workspaceId, sourceId, label });
  }, 201);
}

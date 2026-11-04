export const dynamic = "force-dynamic";
import { taskExportHttp } from "@/server/task-export-http";

type Context = { params: Promise<{ workspaceId: string; bindingId: string }> };

/** Rotation: a new token, shown once; the previous one fails on its next use. */
export async function POST(request: Request, context: Context) {
  return taskExportHttp(request, async (s, caller) => {
    const { workspaceId, bindingId } = await context.params;
    return s.taskExportBindings.rotate(caller, { workspaceId, bindingId });
  });
}

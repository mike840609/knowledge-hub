export const dynamic = "force-dynamic";
import { taskExportHttp } from "@/server/task-export-http";

type Context = { params: Promise<{ workspaceId: string; bindingId: string }> };

/** Revoking a binding revokes its credential; existing Task Results stay readable. */
export async function DELETE(request: Request, context: Context) {
  return taskExportHttp(request, async (s, caller) => {
    const { workspaceId, bindingId } = await context.params;
    await s.taskExportBindings.revoke(caller, { workspaceId, bindingId });
    return null;
  }, 204);
}

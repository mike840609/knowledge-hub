export const dynamic = "force-dynamic";
import { DomainError } from "@/shared/domain/errors";
import { taskExportHttp } from "@/server/task-export-http";

type Context = { params: Promise<{ workspaceId: string; taskResultId: string }> };

/** `{ action: "archive" | "restore" }`, owner only; repeating an action is a no-op. */
export async function POST(request: Request, context: Context) {
  return taskExportHttp(request, async (s, caller) => {
    const { workspaceId, taskResultId } = await context.params;
    const body = (await request.json().catch(() => null)) as { action?: unknown } | null;
    if (body?.action === "archive") await s.taskLifecycle.archive(caller, workspaceId, taskResultId);
    else if (body?.action === "restore") await s.taskLifecycle.restore(caller, workspaceId, taskResultId);
    else throw new DomainError("INVALID_REQUEST", "Use action archive or restore.");
    return null;
  }, 204);
}

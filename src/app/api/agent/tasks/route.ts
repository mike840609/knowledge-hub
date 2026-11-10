// Request-bound private routes must bypass Next auto-mode Request proxies.
export const dynamic = "force-dynamic";
import { ValidationError } from "@/modules/knowledge/domain/errors";
import { isUuid } from "@/shared/ids/uuid";
import { agentReadHttp, agentScope, methodNotAllowed } from "@/server/agent-read";

/**
 * `GET /api/agent/tasks?id=<taskResultId>` — the Task Result's latest revision
 * in the binding's My Space (design §4). A malformed id is the caller's input
 * error, never a lookup.
 */
export async function GET(request: Request): Promise<Response> {
  return agentReadHttp(request, async (services, token) => {
    const id = new URL(request.url).searchParams.get("id") ?? "";
    if (!isUuid(id)) throw new ValidationError("Provide id as a Task Result UUID.");
    const { caller, space } = await agentScope(services, token);
    const task = await services.tasks.get(caller, space, id);
    return { taskResultId: task.taskResultId, revisionNo: task.revisionNo, content: task.content, references: task.references };
  });
}

export const POST = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;

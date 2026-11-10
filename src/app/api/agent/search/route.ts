// Request-bound private routes must bypass Next auto-mode Request proxies.
export const dynamic = "force-dynamic";
import { ValidationError } from "@/modules/knowledge/domain/errors";
import { TaskSearchUnavailableError } from "@/modules/task-knowledge/domain/task-errors";
import { parseTaskSearchQuery } from "@/modules/task-knowledge/domain/task-search-query";
import { agentReadHttp, agentScope, methodNotAllowed, spaceScope } from "@/server/agent-read";

/** At most 20 hits either kind (design §4). */
const HITS = 20;
const QUERY_MAX = 200;

/**
 * `GET /api/agent/search?q=&kind=documents|tasks` — keyword discovery inside
 * the binding's My Space only (design §4). Task search runs only behind its
 * own read flag: with the flag off an agent is never handed unfiltered rows as
 * search results.
 */
export async function GET(request: Request): Promise<Response> {
  return agentReadHttp(request, async (services, token) => {
    const params = new URL(request.url).searchParams;
    const q = params.get("q") ?? "";
    if (q.trim() === "" || q.length > QUERY_MAX) throw new ValidationError(`Provide q as 1–${QUERY_MAX} characters.`);
    const kind = params.get("kind") ?? "documents";
    if (kind !== "documents" && kind !== "tasks") throw new ValidationError('kind must be "documents" or "tasks".');
    const { caller, space } = await agentScope(services, token);

    if (kind === "documents") {
      const result = await services.search.search(caller, { q, scope: spaceScope(space), includeArchived: false, page: 1 });
      return {
        kind,
        hits: result.hits.slice(0, HITS).map((hit) => ({ id: hit.documentId, title: hit.title, path: hit.sourcePath ?? null, snippet: hit.snippet })),
        hasMore: result.hasNext || result.hits.length > HITS,
      };
    }

    if (process.env.TASK_SEARCH_READ_ENABLED !== "true") throw new TaskSearchUnavailableError("Task search is not enabled on this Hub.");
    const list = await services.tasks.list(caller, space, { lifecycle: "ACTIVE", search: parseTaskSearchQuery({ q }) });
    return {
      kind,
      hits: list.items.slice(0, HITS).map((item) => ({ id: item.taskResultId, title: item.title, path: null, snippet: item.summary ?? "" })),
      hasMore: list.items.length > HITS || list.nextCursor !== null,
    };
  });
}

export const POST = methodNotAllowed;
export const HEAD = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
export const OPTIONS = methodNotAllowed;

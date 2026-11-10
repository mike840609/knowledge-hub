// Request-bound private routes must bypass Next auto-mode Request proxies.
export const dynamic = "force-dynamic";
import { ValidationError } from "@/modules/knowledge/domain/errors";
import { agentReadHttp, agentScope, methodNotAllowed } from "@/server/agent-read";

const REF_MAX = 1024;

/**
 * `GET /api/agent/documents?ref=<path or documentId>` — one document's current
 * revision as the same Markdown bundle Copy for Agent builds, with the
 * discussions omitted (design §4, §5). A non-UUID ref is a synced folder path,
 * resolved by the export's own exact-match rule.
 */
export async function GET(request: Request): Promise<Response> {
  return agentReadHttp(request, async (services, token) => {
    const ref = new URL(request.url).searchParams.get("ref") ?? "";
    if (ref === "" || ref.length > REF_MAX) throw new ValidationError(`Provide ref as 1–${REF_MAX} characters.`);
    const { caller, space, documentId } = await agentScope(services, token, ref);
    if (documentId === null) throw new ValidationError("Provide a document reference.");
    const bundle = await services.context.build(caller, space, [documentId], new URL(request.url).origin, { includeDiscussions: false });
    return { documentId, markdown: bundle.markdown };
  });
}

export const POST = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;

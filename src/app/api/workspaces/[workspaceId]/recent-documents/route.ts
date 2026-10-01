import { parseDocumentIdList, requireRouteId } from "@/server/authoring-input";
import { recentDocumentHits } from "@/server/recent-documents";
import { workspaceHttp } from "@/server/workspace-http";

type RecentDocumentsRouteContext = { params: Promise<{ workspaceId: string }> };

/**
 * What the palette lists before anything is typed: the documents in `?ids=` that this caller may read here,
 * by title and source, in the order asked. Titles and where they are — no content — and never cached: a
 * document archived a moment ago must not be offered.
 *
 * The IDs come from the reader's own browser and grant nothing; each is checked (`recentDocumentHits`).
 */
export async function GET(request: Request, context: RecentDocumentsRouteContext) {
  return workspaceHttp(async (services, caller) => {
    const workspaceId = requireRouteId((await context.params).workspaceId, "the workspace");
    const ids = parseDocumentIdList(new URL(request.url).searchParams.get("ids"));
    return { hits: await recentDocumentHits(services, caller, workspaceId, ids) };
  });
}

import { workspaceHttp } from "@/server/workspace-http";
import { restoreRevision } from "@/modules/knowledge/application/restore-revision";
export async function POST(request: Request, context: { params: Promise<{ documentId: string }> }) {
  return workspaceHttp(async (s, c) => {
    const b = await request.json().catch(() => null);
    return restoreRevision(s.queries, s.hub, c, { documentId: (await context.params).documentId, revisionNo: b?.revisionNo, expectedCurrentRevisionId: b?.expectedCurrentRevisionId });
  });
}

import { workspaceHttp } from "@/server/workspace-http";
import { documentExcerpt } from "@/shared/markdown/document-excerpt";

export async function GET(_request: Request, context: { params: Promise<{ documentId: string }> }) {
  return workspaceHttp(async (services, caller) => {
    const { documentId } = await context.params;
    // The regular read service checks membership and excludes archived documents/sources.
    const revision = await services.queries.getCurrentRevision(caller, documentId);
    return { title: revision.title, excerpt: documentExcerpt(revision.markdown) };
  });
}

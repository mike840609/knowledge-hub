import { workspaceHttp } from "@/server/workspace-http";
import { exportMarkdown } from "@/lib/markdown-export";
export async function GET(_request: Request, context: { params: Promise<{ documentId: string }> }) {
  return workspaceHttp(async (s, c) => {
    const revision = await s.queries.getCurrentRevision(c, (await context.params).documentId, { includeArchived: true });
    return new Response(exportMarkdown(revision), { headers: { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": `attachment; filename="document.md"; filename*=UTF-8''${encodeURIComponent(revision.title.replace(/[\x00-\x1f/\\]/g, "_") + ".md").replace(/'/g, "%27")}` } });
  });
}

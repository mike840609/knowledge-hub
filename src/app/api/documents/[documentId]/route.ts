import { parseUpdateDocumentInput } from "@/server/authoring-input";
import { canonicalizeJsonObject } from "@/modules/knowledge/domain/content";
import { workspaceHttp } from "@/server/workspace-http";

type DocumentRouteContext = { params: Promise<{ documentId: string }> };

export async function PATCH(request: Request, context: DocumentRouteContext) {
  return workspaceHttp(async (services, caller) => {
    const { documentId } = await context.params;
    const input = parseUpdateDocumentInput(await request.json().catch(() => null));
    // Spec §6.3: metadata is not editable, so carry the stored value forward
    // rather than clearing frontmatter the import brought in. Reading it outside
    // the write transaction is safe: if current has moved on, createRevision
    // rejects with REVISION_CONFLICT before any mismatched metadata is written.
    // includeArchived: this read only carries metadata forward — lifecycle is the
    // authoritative job of createRevision, which returns SOURCE_ARCHIVED /
    // DOCUMENT_ARCHIVED (409). Without it an archived source/document would
    // short-circuit here to a 404, contradicting spec §7.2 (archived write → 409).
    const current = await services.queries.getCurrentRevision(caller, documentId, { includeArchived: true });
    return services.hub.createRevision(caller, {
      documentId,
      expectedCurrentRevisionId: input.expectedCurrentRevisionId,
      title: input.title,
      markdown: input.markdown,
      metadata: canonicalizeJsonObject(current.metadata),
    });
  });
}

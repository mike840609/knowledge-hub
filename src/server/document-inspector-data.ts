import type { DocumentInspectorData } from "@/components/knowledge/document-inspector";
import { toGraphViewData } from "@/components/knowledge/graph-model";
import { createHrefForNode, createLinksFor, mayCreateFromLink } from "@/lib/create-from-link";
import type { DocumentLinkView } from "@/modules/knowledge/application/knowledge-link-service";
import type { RevisionSummary } from "@/server/knowledge-read";

/**
 * What the Details panel shows of a document. The reader and the composer both open it, so it is
 * assembled once: a panel that differs between reading and editing would be a page that moves.
 */
export function documentInspectorData(input: {
  workspaceId: string;
  workspaceName: string | undefined;
  /** The workspace's kind: a team offers no create-from-link entry, whatever the member may write. */
  workspaceType: "PERSONAL" | "TEAM";
  sourceId: string;
  sourceName: string | undefined;
  sourcePath: string | null | undefined;
  documentId: string;
  status: "ACTIVE" | "ARCHIVED";
  revisions: RevisionSummary[];
  selectedRevisionNo: number;
  includeArchived: boolean;
  linkView: DocumentLinkView | null;
  /** Whether a broken link may offer to make the document it names. */
  canCreate: boolean;
  graphDepth: 1 | 2;
  /** Null hides the depth switch: from the composer it would leave the editor. */
  depthHrefs: { 1: string; 2: string } | null;
}): DocumentInspectorData {
  const { workspaceId, sourceId, documentId, linkView, canCreate } = input;
  const mayCreate = mayCreateFromLink(canCreate, input.workspaceType);
  return {
    workspaceId,
    workspaceName: input.workspaceName ?? workspaceId,
    sourceId,
    sourceName: input.sourceName ?? sourceId,
    sourcePath: input.sourcePath,
    documentId,
    status: input.status,
    revisions: input.revisions,
    selectedRevisionNo: input.selectedRevisionNo,
    includeArchived: input.includeArchived,
    links: linkView,
    createLinks: linkView ? createLinksFor(linkView, mayCreate) : {},
    localGraph: linkView?.localGraph && linkView.localGraph.nodes.length > 0
      ? {
          data: toGraphViewData({
            workspaceId,
            nodes: linkView.localGraph.nodes,
            edges: linkView.localGraph.edges,
            sourceNames: new Map([[sourceId, input.sourceName ?? ""]]),
            createHref: (node) => createHrefForNode(workspaceId, node, mayCreate),
          }),
          depth: input.graphDepth,
          openHref: `/w/${workspaceId}/graph?focus=${documentId}`,
          depthHrefs: input.depthHrefs,
        }
      : null,
  };
}

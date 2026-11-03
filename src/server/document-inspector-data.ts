import type { DocumentInspectorData } from "@/components/knowledge/document-inspector";
import { toGraphViewData } from "@/components/knowledge/graph-model";
import { createHrefForNode, createLinksFor } from "@/lib/create-from-link";
import type { DocumentLinkView } from "@/modules/knowledge/application/knowledge-link-service";
import type { RevisionSummary } from "@/server/knowledge-read";

/**
 * Where Copy for Agent opens with this document's link neighbourhood preselected, or `null` when
 * it may not be offered or no other document is linked (a broken link alone preselects nothing new).
 */
export function neighbourhoodContextHref(input: {
  workspaceId: string;
  documentId: string;
  depth: 1 | 2;
  eligible: boolean;
  nodes: readonly { id: string; kind: "DOCUMENT" | "UNRESOLVED" }[] | null;
}): string | null {
  if (!input.eligible || !input.nodes?.some((node) => node.kind === "DOCUMENT" && node.id !== input.documentId)) return null;
  return `/w/${input.workspaceId}/agent-context?around=${input.documentId}&depth=${input.depth}`;
}

/**
 * What the Details panel shows of a document. The reader and the composer both open it, so it is
 * assembled once: a panel that differs between reading and editing would be a page that moves.
 */
export function documentInspectorData(input: {
  workspaceId: string;
  workspaceName: string | undefined;
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
  /** Whether Copy for Agent is available for this document (the action registry's condition). */
  agentContext: boolean;
}): DocumentInspectorData {
  const { workspaceId, sourceId, documentId, linkView, canCreate } = input;
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
    createLinks: linkView ? createLinksFor(linkView, canCreate) : {},
    localGraph: linkView?.localGraph && linkView.localGraph.nodes.length > 0
      ? {
          data: toGraphViewData({
            workspaceId,
            nodes: linkView.localGraph.nodes,
            edges: linkView.localGraph.edges,
            sourceNames: new Map([[sourceId, input.sourceName ?? ""]]),
            createHref: (node) => createHrefForNode(workspaceId, node, canCreate),
          }),
          depth: input.graphDepth,
          openHref: `/w/${workspaceId}/graph?focus=${documentId}`,
          depthHrefs: input.depthHrefs,
          // Not from the composer (no depth links there): the bundle reads the saved revision, and the link would leave the editor.
          agentContextHref: input.depthHrefs
            ? neighbourhoodContextHref({ workspaceId, documentId, depth: input.graphDepth, eligible: input.agentContext, nodes: linkView.localGraph.nodes })
            : null,
        }
      : null,
  };
}

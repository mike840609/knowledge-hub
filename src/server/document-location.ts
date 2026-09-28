import type { KnowledgeTreeItem } from "@/modules/knowledge/application/knowledge-query-service";
import type { DocumentBreadcrumbSegment } from "@/components/knowledge/document-breadcrumb";

/** Source › folders… leading to a document, without the document itself. The reader and the composer each add the title. */
export function documentLocation(
  workspaceId: string,
  sourceId: string,
  sourceName: string,
  tree: KnowledgeTreeItem[],
  documentId: string,
): DocumentBreadcrumbSegment[] {
  const segments: DocumentBreadcrumbSegment[] = [{ label: sourceName, href: `/w/${workspaceId}/knowledge/${sourceId}` }];
  const byId = new Map(tree.map((item) => [item.id, item]));
  const node = tree.find((item) => item.type === "document" && item.documentId === documentId);
  if (!node) return segments;
  const folders: string[] = [];
  let current = node.parentId ? byId.get(node.parentId) : undefined;
  while (current) {
    if (current.type === "folder") folders.unshift(current.label);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  for (const folder of folders) segments.push({ label: folder });
  return segments;
}

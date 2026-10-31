import type { DocumentLinkView } from "@/modules/knowledge/application/knowledge-link-service";
import { titleForNewDocument } from "@/modules/knowledge/domain/wiki-link-title";

/**
 * Making the document a `[[link]]` names (daily-driver spec §6.2). A link that goes nowhere can be
 * followed to the new-document page with the title it needs already in the field; the document is
 * made by the ordinary create request, so nothing here decides who may write — it only decides which
 * links are worth offering, and to whom.
 */

/**
 * Whether a broken link may offer to make the document it names. Writing is only a UI path in a My
 * Space: a team takes content from publishing alone, so an unresolved wikilink there is plain text
 * even for a member who may write. The create request itself still decides who may write.
 */
export function mayCreateFromLink(canWrite: boolean, workspaceType: "PERSONAL" | "TEAM" | undefined): boolean {
  return canWrite && workspaceType !== "TEAM";
}

/** `/w/:ws/knowledge/new` with the title to start from, and the document to go back to on Cancel. */
export function newDocumentHref(workspaceId: string, title: string, from: string | null = null): string {
  const query = new URLSearchParams({ title });
  if (from) query.set("from", from);
  return `/w/${workspaceId}/knowledge/new?${query.toString()}`;
}

/**
 * For each unresolved wikilink of a document: where to make the document it names, keyed by the
 * link's `lookupKey` (how a renderer finds it). Empty when `canWrite` is false — pass
 * `mayCreateFromLink`, so a team member who may write still sees the link as plain text; and only
 * for a wikilink whose target a title can answer (`titleForNewDocument`) — a relative `.md` path
 * names a place in a source, which a document made here does not occupy.
 */
export function createLinksFor(view: DocumentLinkView, canWrite: boolean): Record<string, string> {
  const links: Record<string, string> = {};
  if (!canWrite) return links;
  for (const link of view.unresolved) {
    if (link.kind !== "WIKI") continue;
    const title = titleForNewDocument(link.target);
    if (title !== null) links[link.lookupKey] = newDocumentHref(view.workspaceId, title, view.documentId);
  }
  return links;
}

/** The same for a node of the graph: an unresolved target, by the id the graph gives it (`unresolved:WIKI:…`). No `from`: several documents may write it. `canWrite` is `mayCreateFromLink`'s answer. */
export function createHrefForNode(workspaceId: string, node: { id: string; kind: "DOCUMENT" | "UNRESOLVED"; title: string }, canWrite: boolean): string | null {
  if (!canWrite || node.kind !== "UNRESOLVED" || !node.id.startsWith("unresolved:WIKI:")) return null;
  const title = titleForNewDocument(node.title);
  return title === null ? null : newDocumentHref(workspaceId, title);
}

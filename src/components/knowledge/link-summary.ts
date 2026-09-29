import type { DocumentLinkView } from "@/modules/knowledge/application/knowledge-link-service";

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * The one phrase the document header says about a document's links, or `null`
 * when there is nothing worth opening the Links tab for.
 *
 * Backlinks lead: they are the part a reader cannot see from the page itself,
 * and the part that says a document matters to others. A document nothing links
 * to but that links out still says so, because its neighbourhood graph is worth
 * finding. Unresolved links alone say nothing here — the page already marks
 * them where they are written, and a header that announced every stray
 * `[[name]]` would be noise.
 *
 * `backlinkTotal`, not `backlinks.length`: the list can be capped, the total
 * cannot, and the phrase has to agree with the count on the tab it opens.
 */
export function summariseLinks(view: Pick<DocumentLinkView, "backlinkTotal" | "outgoing"> | null): string | null {
  if (!view) return null;
  if (view.backlinkTotal > 0) return plural(view.backlinkTotal, "backlink", "backlinks");
  const outgoing = view.outgoing.filter((link) => link.resolution.status === "RESOLVED").length;
  if (outgoing > 0) return plural(outgoing, "outgoing link", "outgoing links");
  return null;
}

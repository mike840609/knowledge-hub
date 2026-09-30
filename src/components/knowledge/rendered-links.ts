import type { DocumentLinkView } from "@/modules/knowledge/application/knowledge-link-service";

/**
 * What a renderer needs to know about the links a document writes: for each,
 * where it goes, or that it goes nowhere. Keyed by `linkLookupKey`, so the
 * renderer looks a link up by the same key the server filed it under.
 */
export type RenderedLinkTarget =
  | {
      status: "RESOLVED";
      /** The route of the target document, without a fragment. */
      basePath: string;
      title: string;
      ambiguousWith: number;
    }
  | {
      status: "UNRESOLVED";
      /** Where to make the document this link names, when the reader may (`createLinksFor`). */
      createHref?: string;
    };

export type RenderedLinks = Record<string, RenderedLinkTarget>;

export function documentPath(workspaceId: string, sourceId: string, documentId: string): string {
  return `/w/${workspaceId}/knowledge/${sourceId}/${documentId}`;
}

export function renderedLinksFrom(view: DocumentLinkView, createLinks: Readonly<Record<string, string>> = {}): RenderedLinks {
  const links: RenderedLinks = {};
  for (const link of view.outgoing) {
    links[link.lookupKey] =
      link.resolution.status === "RESOLVED"
        ? {
            status: "RESOLVED",
            basePath: documentPath(view.workspaceId, link.resolution.sourceId, link.resolution.documentId),
            title: link.resolution.title,
            ambiguousWith: link.resolution.ambiguousWith,
          }
        : { status: "UNRESOLVED", ...(createLinks[link.lookupKey] ? { createHref: createLinks[link.lookupKey] } : {}) };
  }
  return links;
}

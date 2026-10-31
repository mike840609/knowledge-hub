import type { CatalogDocument, LinkOrigin } from "../../domain/link-resolution";

/** A document as a link's origin, with the catalog's path for it when the catalog holds it. */
export function linkOrigin(
  document: { id: string; sourceId: string },
  entry: Pick<CatalogDocument, "sourcePath"> | undefined,
): LinkOrigin {
  return { documentId: document.id, sourceId: document.sourceId, sourcePath: entry?.sourcePath ?? null };
}

/** The same, looked up in a Workspace's catalog. */
export function originOf(catalog: readonly CatalogDocument[], document: { id: string; sourceId: string }): LinkOrigin {
  return linkOrigin(document, catalog.find((candidate) => candidate.documentId === document.id));
}

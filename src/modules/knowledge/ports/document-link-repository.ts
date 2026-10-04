import type { ExtractedLink } from "../domain/document-links";
import type { CatalogDocument } from "../domain/link-resolution";

/** The valid outgoing edges of one document. */
export type IndexedDocumentLinks = {
  documentId: string;
  links: ExtractedLink[];
};

/**
 * How much of a Workspace's link index can be trusted right now. `stale`
 * counts ACTIVE documents whose index row is missing, was extracted from an
 * older revision, or was extracted by an older version of the rules.
 */
export type LinkIndexState = {
  documents: number;
  stale: number;
};

/** A document a `[[wikilink]]` can be written to, as the editor offers it. */
export type LinkTargetRow = {
  documentId: string;
  sourceId: string;
  title: string;
  /** When the current revision was written: what "recently edited" means to someone choosing a link. */
  editedAt: Date;
};

/**
 * The link index (graph spec §7): raw edges per document, for the document's
 * current revision. Derived data — reading it never authorizes anything.
 */
export interface DocumentLinkRepository {
  /**
   * Makes `links` the document's edges, recorded against `revisionId`. Called
   * in the same transaction that wrote the revision, with the document lock
   * held, so it replaces rather than merges.
   */
  loadHealthEdges(
    workspaceId: string,
    sourceId: string,
    cursor: { documentId: string; ordinal: number } | null,
    limit: number,
  ): Promise<{ documentId: string; link: ExtractedLink }[]>;
  replaceForDocument(input: {
    documentId: string;
    revisionId: string;
    links: readonly ExtractedLink[];
  }): Promise<void>;

  /** ACTIVE documents in ACTIVE sources of one Workspace, as link targets. */
  loadCatalog(workspaceId: string): Promise<CatalogDocument[]>;

  /**
   * The same documents `loadCatalog` gives — the ones a link can resolve to — most recently edited
   * first, at most `limit` of them. It is its own query, not the catalog cut down, so that an editor's
   * list of suggestions does not read a Workspace's every path and creation time to show titles.
   */
  loadLinkTargets(workspaceId: string, limit: number): Promise<LinkTargetRow[]>;

  /** Edges of the Workspace's ACTIVE documents whose index row is still valid. */
  loadValidEdges(workspaceId: string): Promise<IndexedDocumentLinks[]>;

  countIndexState(workspaceId: string): Promise<LinkIndexState>;

  /** Current Markdown of documents in one Workspace, for showing where a link sits. */
  loadCurrentMarkdown(
    workspaceId: string,
    documentIds: readonly string[],
  ): Promise<Map<string, string>>;

  /**
   * Documents (any status) whose index row is missing or no longer matches
   * their current revision or the current rules, ordered by id, after `afterId`.
   * For the repair script.
   */
  listStaleDocumentIds(limit: number, afterId?: string): Promise<string[]>;
}

/**
 * Append-only record of changes to personal originals, written in the same
 * transaction as the change itself (Knowledge owns this port; its transactions
 * call it directly, and Knowledge never imports Sources).
 *
 * `revisionId` identifies the change for diagnostics; consumers always re-read
 * the document's current state, so a late or repeated event cannot regress a
 * team copy.
 */
export type PublicationEventInput = {
  documentId: string | null;
  treeNodeId: string | null;
  sourceId?: string | null;
  kind: "REVISION" | "TREE" | "LIFECYCLE" | "SOURCE";
  revisionId?: string | null;
  at: Date;
};

export interface PublicationEventRepository {
  record(event: PublicationEventInput): Promise<void>;
  recordMany(events: readonly PublicationEventInput[]): Promise<void>;
}

import type { KnowledgeLifecycle } from "../domain/lifecycle";

/**
 * Narrow lifecycle view of a SourceEntry for Knowledge transactions.
 *
 * Hub document/folder archive and restore must update the linked SourceEntry
 * in the same transaction when one exists, but Knowledge must not depend on
 * the Sources module. This port exposes only the identity, scope, and
 * lifecycle columns the lifecycle internals need; locators, hashes, and
 * external IDs stay with the Sources entry port.
 */
export type LinkedSourceEntry = {
  id: string;
  sourceId: string;
  documentId: string | null;
  treeNodeId: string | null;
  status: KnowledgeLifecycle;
  updatedBy: string;
  archivedBy: string | null;
  archivedAt: Date | null;
  lastSeenAt: Date;
};

export interface LinkedEntryRepository {
  findByDocumentId(documentId: string): Promise<LinkedSourceEntry | null>;
  findByTreeNodeId(treeNodeId: string): Promise<LinkedSourceEntry | null>;
  update(entry: LinkedSourceEntry): Promise<void>;
}

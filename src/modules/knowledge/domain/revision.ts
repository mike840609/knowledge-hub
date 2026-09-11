import type { ContentInput, KnowledgeMetadata, RevisionContentInput } from "./content";
import { isSameRevisionContent } from "./content";

export type KnowledgeRevision = ContentInput & {
  id: string;
  documentId: string;
  revisionNo: number;
  contentHash: string;
  createdBy: string;
  createdAt: Date;
};

export function revisionContent(revision: KnowledgeRevision): ContentInput {
  return {
    title: revision.title,
    markdown: revision.markdown,
    metadata: revision.metadata as KnowledgeMetadata,
  };
}

// Spec §13.1: compare a stored revision row against a candidate payload by
// canonical content. Returns the stored revision unchanged on equality (NOOP);
// all historical fields (id, revisionNo, contentHash, createdBy, createdAt)
// are preserved by the caller.
export function isRevisionContentUnchanged(stored: KnowledgeRevision, candidate: RevisionContentInput): boolean {
  return isSameRevisionContent(revisionContent(stored), candidate);
}

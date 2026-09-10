import type { ContentInput, KnowledgeMetadata } from "./content";

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

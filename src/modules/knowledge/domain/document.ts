import type { KnowledgeLifecycle } from "./lifecycle";

export type KnowledgeDocument = {
  id: string;
  sourceId: string;
  currentRevisionId: string | null;
  status: KnowledgeLifecycle;
  createdBy: string;
  updatedBy: string;
  archivedBy: string | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

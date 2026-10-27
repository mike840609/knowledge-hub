import type { KnowledgeLifecycle } from "./lifecycle";

export type KnowledgeDocument = {
  id: string;
  sourceId: string;
  currentRevisionId: string | null;
  status: KnowledgeLifecycle;
  /** A short emoji chosen for the page, or null for the default file glyph. */
  pageIcon?: string | null;
  createdBy: string;
  updatedBy: string;
  archivedBy: string | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

/** Phase 4 spec §6.2: one row per matching Document, already scoped by the caller's readable Workspaces. */
export type KnowledgeSearchRow = {
  documentId: string;
  sourceId: string;
  workspaceId: string;
  title: string;
  sourceName: string;
  workspaceName: string;
  snippet: string;
  status: "ACTIVE" | "ARCHIVED";
  updatedAt: Date;
};

export type KnowledgeSearchCriteria = {
  /** Already parsed and de-duplicated; every term must match (AND). */
  terms: readonly string[];
  /** Workspaces the caller may READ. An empty list must produce no rows. */
  workspaceIds: readonly string[];
  sourceId: string | null;
  includeArchived: boolean;
  limit: number;
  offset: number;
};

export interface KnowledgeSearchRepository {
  search(criteria: KnowledgeSearchCriteria): Promise<KnowledgeSearchRow[]>;
}

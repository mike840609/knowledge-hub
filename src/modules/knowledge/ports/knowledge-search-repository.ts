/** Phase 4 spec §6.2: one row per matching Document, already scoped by the caller's readable Workspaces. */
export type KnowledgeSearchRow = {
  documentId: string;
  sourceId: string;
  workspaceId: string;
  title: string;
  sourceName: string;
  sourcePath?:string|null;
  workspaceName: string;
  snippet: string;
  /** Whether `snippet` was cut out of a longer body at either end, so a reader can mark the cut. */
  snippetClipped?: { start: boolean; end: boolean };
  status: "ACTIVE" | "ARCHIVED";
  updatedAt: Date;
};

export type KnowledgeSearchCriteria = {
  /** Already parsed and de-duplicated; every term must match (AND). */
  terms: readonly string[];
  filters?: import("../domain/search-filters").SearchFilters;
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

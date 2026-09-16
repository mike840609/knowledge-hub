import { SearchTimeoutError } from "@/modules/knowledge/domain/errors";
import { toLikePattern } from "@/modules/knowledge/domain/search-query";
import type {
  KnowledgeSearchCriteria,
  KnowledgeSearchRepository,
  KnowledgeSearchRow,
} from "@/modules/knowledge/ports/knowledge-search-repository";
import type { DbRow, QueryConnection } from "./shared";
import { asDate, asRequiredString } from "./shared";

/** MariaDB reports a max_statement_time interruption as errno 1969. */
const SEARCH_TIMEOUT_ERRNO = 1969;
const SEARCH_TIMEOUT_SECONDS = 5;
const SNIPPET_LENGTH = 160;
const SNIPPET_LEAD = 60;

function mapRow(row: DbRow): KnowledgeSearchRow {
  return {
    documentId: String(row.document_id),
    sourceId: String(row.source_id),
    workspaceId: String(row.workspace_id),
    title: asRequiredString(row.title, "search title"),
    sourceName: asRequiredString(row.source_name, "search source name"),
    workspaceName: asRequiredString(row.workspace_name, "search workspace name"),
    snippet: row.snippet === null || row.snippet === undefined ? "" : String(row.snippet),
    status: String(row.status) as "ACTIVE" | "ARCHIVED",
    updatedAt: asDate(row.updated_at),
  };
}

function isTimeout(error: unknown): boolean {
  return typeof error === "object" && error !== null && "errno" in error
    && Number((error as { errno: unknown }).errno) === SEARCH_TIMEOUT_ERRNO;
}

export class MariaDbKnowledgeSearchRepository implements KnowledgeSearchRepository {
  constructor(private readonly connection: QueryConnection) {}

  /**
   * Spec §6.2. One statement: the tree-node join reproduces the Knowledge
   * Tree's default visibility (uq_tree_one_document keeps it row-preserving),
   * and the snippet is computed in the same pass so no second query is needed.
   */
  async search(criteria: KnowledgeSearchCriteria): Promise<KnowledgeSearchRow[]> {
    if (criteria.terms.length === 0 || criteria.workspaceIds.length === 0) return [];
    const anchor = criteria.terms[0];
    const parameters: unknown[] = [anchor, anchor, SNIPPET_LEAD, SNIPPET_LENGTH, SNIPPET_LENGTH];
    const titleHits = criteria.terms
      .map(() => "(r.title COLLATE utf8mb4_unicode_ci LIKE ? ESCAPE '!')")
      .join(" + ");
    for (const term of criteria.terms) parameters.push(toLikePattern(term));
    parameters.push(...criteria.workspaceIds);
    parameters.push(criteria.includeArchived ? 1 : 0);
    parameters.push(criteria.sourceId === null ? 1 : 0, criteria.sourceId);
    const termClauses = criteria.terms.map(
      () => "(r.title COLLATE utf8mb4_unicode_ci LIKE ? ESCAPE '!' OR r.markdown COLLATE utf8mb4_unicode_ci LIKE ? ESCAPE '!')",
    );
    for (const term of criteria.terms) {
      const pattern = toLikePattern(term);
      parameters.push(pattern, pattern);
    }
    parameters.push(criteria.limit, criteria.offset);
    const sql = `SET STATEMENT max_statement_time=${SEARCH_TIMEOUT_SECONDS} FOR
      SELECT d.id AS document_id, d.source_id AS source_id, s.workspace_id AS workspace_id, r.title AS title,
             s.name AS source_name, w.name AS workspace_name, d.status AS status, d.updated_at AS updated_at,
             CASE WHEN LOCATE(?, r.markdown COLLATE utf8mb4_unicode_ci) > 0
                  THEN SUBSTRING(r.markdown, GREATEST(LOCATE(?, r.markdown COLLATE utf8mb4_unicode_ci) - ?, 1), ?)
                  ELSE SUBSTRING(r.markdown, 1, ?) END AS snippet,
             (${titleHits}) AS title_hits
      FROM knowledge_documents d
      JOIN knowledge_revisions r ON r.id = d.current_revision_id
      JOIN knowledge_tree_nodes n ON n.document_id = d.id
      JOIN knowledge_sources s ON s.id = d.source_id
      JOIN workspaces w ON w.id = s.workspace_id
      WHERE s.workspace_id IN (${criteria.workspaceIds.map(() => "?").join(", ")})
        AND (? = 1 OR (d.status = 'ACTIVE' AND s.status = 'ACTIVE' AND n.status = 'ACTIVE'))
        AND (? = 1 OR d.source_id = ?)
        AND ${termClauses.join(" AND ")}
      ORDER BY title_hits DESC, d.updated_at DESC, d.id ASC
      LIMIT ? OFFSET ?`;
    try {
      const rows = await this.connection.query<DbRow[]>(sql, parameters);
      return rows.map(mapRow);
    } catch (error) {
      if (isTimeout(error)) throw new SearchTimeoutError();
      throw error;
    }
  }
}

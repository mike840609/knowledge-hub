import type { TaskSearchQuery } from "@/modules/task-knowledge/domain/task-search-query";
import { buildTaskSearchLikePattern } from "@/modules/task-knowledge/domain/task-search-query";
import type { TaskSearchCursor } from "@/modules/task-knowledge/domain/task-search-cursor";

/** Scope is mandatory even though application service already checks My Space ownership. */
export function buildTaskSearchSql(
  workspaceId: string,
  ownerUserId: string,
  query: TaskSearchQuery,
  cursor: TaskSearchCursor | null,
  limit: number,
): { sql: string; params: Array<string | number> } {
  const where: string[] = [
    "b.workspace_id = ? AND b.owner_user_id = ?",
    "t.lifecycle = ?",
  ];
  const params: Array<string | number> = [workspaceId, ownerUserId, query.lifecycle];
  if (query.agent) { where.push("p.agent = ?"); params.push(query.agent); }
  if (query.verification) { where.push("p.verification_status = ?"); params.push(query.verification); }
  if (query.fromEpochMs !== null) { where.push("p.completed_at_epoch_ms >= ?"); params.push(query.fromEpochMs); }
  if (query.beforeEpochMs !== null) { where.push("p.completed_at_epoch_ms < ?"); params.push(query.beforeEpochMs); }
  for (const term of query.terms) {
    where.push("(p.title COLLATE utf8mb4_unicode_ci LIKE ? ESCAPE '!' OR p.search_body COLLATE utf8mb4_unicode_ci LIKE ? ESCAPE '!')");
    const pattern = buildTaskSearchLikePattern(term);
    params.push(pattern, pattern);
  }
  if (cursor) {
    where.push("(p.completed_at_epoch_ms < ? OR (p.completed_at_epoch_ms = ? AND t.id < ?))");
    params.push(cursor.completedAtEpochMs, cursor.completedAtEpochMs, cursor.taskResultId);
  }
  params.push(limit);
  return {
    sql: `SET STATEMENT max_statement_time=5 FOR
      SELECT t.id AS task_result_id, t.lifecycle, t.latest_revision_no,
        b.label AS binding_label, b.status AS binding_status,
        p.completed_at_epoch_ms, p.agent, p.verification_status, p.title, p.summary, p.search_body
      FROM task_results t
      JOIN task_export_bindings b ON b.id = t.binding_id
      JOIN task_result_search p ON p.task_result_id = t.id AND p.revision_no = t.latest_revision_no
      WHERE ${where.join(" AND ")}
      ORDER BY p.completed_at_epoch_ms DESC, t.id DESC LIMIT ?`,
    params,
  };
}


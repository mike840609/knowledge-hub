import type {
  SyncRunChange,
  RunCursor,
} from "@/modules/sources/domain/sync-run-change";
import type { SyncRunChangeRepository } from "@/modules/sources/ports/sync-run-change-repository";
import type { SyncRun } from "@/modules/sources/domain/sync-run";
import { mapSyncRun } from "./sync-runs";
import { asNumber, insertBatches, valueRows, type DbRow, type QueryConnection } from "./shared";
function jsonArray<T>(value: unknown): T[] {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (!Array.isArray(parsed))
    throw new Error("Invalid persisted sync change array.");
  return parsed as T[];
}
function nullableString(value: unknown): string | null {
  return value == null ? null : String(value);
}
function positiveLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
    throw new Error("Invalid history limit.");
}
function mapChange(row: DbRow): SyncRunChange {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    sourceId: String(row.source_id),
    workspaceId: String(row.workspace_id),
    ordinal: asNumber(row.ordinal, "change ordinal"),
    kind: String(row.kind) as SyncRunChange["kind"],
    labels: jsonArray(row.labels),
    sourcePath: String(row.source_path),
    previousPath: nullableString(row.previous_path),
    title: String(row.title),
    documentId: nullableString(row.document_id),
    beforeRevisionId: nullableString(row.before_revision_id),
    afterRevisionId: nullableString(row.after_revision_id),
    beforeRevisionNo:
      row.before_revision_no == null
        ? null
        : asNumber(row.before_revision_no, "before revision"),
    afterRevisionNo:
      row.after_revision_no == null
        ? null
        : asNumber(row.after_revision_no, "after revision"),
    diagnostics: jsonArray(row.diagnostics),
  };
}

export class MariaDbSyncRunChangeRepository implements SyncRunChangeRepository {
  constructor(private readonly connection: QueryConnection) {}
  async listReadingChanges(
    runId: string,
    input: {
      userId: string;
      workspaceId: string;
      unreadOnly?: boolean;
      limit: number;
    },
  ): Promise<{
    changes: SyncRunChange[];
    total: number;
    added: number;
    updated: number;
  }> {
    positiveLimit(input.limit);
    const from = `FROM sync_run_changes c JOIN knowledge_documents d ON d.id=c.document_id AND d.source_id=c.source_id AND d.status='ACTIVE'
      LEFT JOIN document_read_progress p ON p.document_id=c.document_id AND p.workspace_id=c.workspace_id AND p.user_id=?
      WHERE c.run_id=? AND c.workspace_id=? AND c.kind='DOCUMENT' AND c.after_revision_no>COALESCE(c.before_revision_no,0)
      AND (JSON_CONTAINS(c.labels,'"ADDED"') OR JSON_CONTAINS(c.labels,'"UPDATED"')) ${input.unreadOnly ? "AND c.after_revision_no>COALESCE(p.revision_no,0)" : ""}`;
    const params = [input.userId, runId, input.workspaceId];
    const counts = await this.connection.query<DbRow[]>(
      `SELECT COUNT(*) AS total,COALESCE(SUM(JSON_CONTAINS(c.labels,'"ADDED"')),0) AS added ${from}`,
      params,
    );
    const rows = await this.connection.query<DbRow[]>(
      `SELECT c.* ${from} ORDER BY c.ordinal LIMIT ?`,
      [...params, input.limit],
    );
    const total = asNumber(counts[0].total, "reading count"),
      added = asNumber(counts[0].added, "added count");
    return {
      changes: rows.map(mapChange),
      total,
      added,
      updated: total - added,
    };
  }
  async listDiagnosticChanges(
    runId: string,
    afterOrdinal: number,
    limit: number,
  ): Promise<SyncRunChange[]> {
    positiveLimit(limit);
    const rows = await this.connection.query<DbRow[]>(
      "SELECT * FROM sync_run_changes WHERE run_id=? AND ordinal>=? AND JSON_LENGTH(diagnostics)>0 ORDER BY ordinal LIMIT ?",
      [runId, afterOrdinal, limit],
    );
    return rows.map(mapChange);
  }
  async insertMany(changes: SyncRunChange[]): Promise<void> {
    const rows = changes.map((c) => ({ c, labels: JSON.stringify(c.labels), diagnostics: JSON.stringify(c.diagnostics) }));
    for (const batch of insertBatches(rows, (row) => row.diagnostics.length + (row.c.title?.length ?? 0) * 3)) {
      await this.connection.query(
        `INSERT INTO sync_run_changes (id,run_id,source_id,workspace_id,ordinal,kind,labels,source_path,previous_path,title,document_id,before_revision_id,after_revision_id,before_revision_no,after_revision_no,diagnostics) VALUES ${valueRows(batch.length, 16)}`,
        batch.flatMap(({ c, labels, diagnostics }) => [
          c.id, c.runId, c.sourceId, c.workspaceId, c.ordinal, c.kind, labels, c.sourcePath, c.previousPath, c.title,
          c.documentId, c.beforeRevisionId, c.afterRevisionId, c.beforeRevisionNo, c.afterRevisionNo, diagnostics,
        ]),
      );
    }
  }
  async listByRun(
    runId: string,
    afterOrdinal: number,
    limit: number,
  ): Promise<SyncRunChange[]> {
    positiveLimit(limit);
    if (!Number.isSafeInteger(afterOrdinal) || afterOrdinal < 0)
      throw new Error("Invalid history cursor.");
    const rows = await this.connection.query<DbRow[]>(
      "SELECT * FROM sync_run_changes WHERE run_id=? AND ordinal>? ORDER BY ordinal LIMIT ?",
      [runId, afterOrdinal, limit],
    );
    return rows.map(mapChange);
  }
  async listAppliedRuns(
    workspaceId: string,
    options: { sourceId?: string; cursor?: RunCursor; limit: number },
  ): Promise<SyncRun[]> {
    positiveLimit(options.limit);
    const filters = ["s.workspace_id=?", "r.status='APPLIED'"];
    const values: unknown[] = [workspaceId];
    if (options.sourceId) {
      filters.push("r.source_id=?");
      values.push(options.sourceId);
    }
    if (options.cursor) {
      const date = new Date(options.cursor.completedAt);
      if (Number.isNaN(date.getTime())) throw new Error("Invalid run cursor.");
      filters.push("(r.completed_at<? OR (r.completed_at=? AND r.id<?))");
      values.push(date, date, options.cursor.runId);
    }
    values.push(options.limit);
    const rows = await this.connection.query<DbRow[]>(
      `SELECT r.* FROM sync_runs r JOIN knowledge_sources s ON s.id=r.source_id WHERE ${filters.join(" AND ")} ORDER BY r.completed_at DESC,r.id DESC LIMIT ?`,
      values,
    );
    return rows.map(mapSyncRun);
  }
}

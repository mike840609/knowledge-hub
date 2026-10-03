import type { SyncRunChange, RunCursor } from "@/modules/sources/domain/sync-run-change";
import type { SyncRunChangeRepository } from "@/modules/sources/ports/sync-run-change-repository";
import type { SyncRun } from "@/modules/sources/domain/sync-run";
import { mapSyncRun } from "./sync-runs";
import { asNumber, type DbRow, type QueryConnection } from "./shared";
function jsonArray<T>(value: unknown): T[] {
  const parsed=typeof value === "string" ? JSON.parse(value) : value;
  if(!Array.isArray(parsed)) throw new Error("Invalid persisted sync change array.");
  return parsed as T[];
}
function nullableString(value: unknown): string | null {return value == null ? null : String(value);}
function positiveLimit(limit: number): void {if(!Number.isSafeInteger(limit)||limit<1||limit>1000) throw new Error("Invalid history limit.");}
export class MariaDbSyncRunChangeRepository implements SyncRunChangeRepository {
  constructor(private readonly connection: QueryConnection) {}
  async insertMany(changes: SyncRunChange[]): Promise<void> {
    for(const c of changes) await this.connection.query(
      `INSERT INTO sync_run_changes (id,run_id,source_id,workspace_id,ordinal,kind,labels,source_path,previous_path,title,document_id,before_revision_id,after_revision_id,before_revision_no,after_revision_no,diagnostics) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [c.id,c.runId,c.sourceId,c.workspaceId,c.ordinal,c.kind,JSON.stringify(c.labels),c.sourcePath,c.previousPath,c.title,c.documentId,c.beforeRevisionId,c.afterRevisionId,c.beforeRevisionNo,c.afterRevisionNo,JSON.stringify(c.diagnostics)],
    );
  }
  async listByRun(runId: string, afterOrdinal: number, limit: number): Promise<SyncRunChange[]> {
    positiveLimit(limit);if(!Number.isSafeInteger(afterOrdinal)||afterOrdinal<0) throw new Error("Invalid history cursor.");
    const rows=await this.connection.query<DbRow[]>("SELECT * FROM sync_run_changes WHERE run_id=? AND ordinal>? ORDER BY ordinal LIMIT ?",[runId,afterOrdinal,limit]);
    return rows.map(row=>({id:String(row.id),runId:String(row.run_id),sourceId:String(row.source_id),workspaceId:String(row.workspace_id),ordinal:asNumber(row.ordinal,"change ordinal"),kind:String(row.kind) as SyncRunChange["kind"],labels:jsonArray(row.labels),sourcePath:String(row.source_path),previousPath:nullableString(row.previous_path),title:String(row.title),documentId:nullableString(row.document_id),beforeRevisionId:nullableString(row.before_revision_id),afterRevisionId:nullableString(row.after_revision_id),beforeRevisionNo:row.before_revision_no==null?null:asNumber(row.before_revision_no,"before revision"),afterRevisionNo:row.after_revision_no==null?null:asNumber(row.after_revision_no,"after revision"),diagnostics:jsonArray(row.diagnostics)}));
  }
  async listAppliedRuns(workspaceId: string, options: {sourceId?: string;cursor?: RunCursor;limit:number}): Promise<SyncRun[]> {
    positiveLimit(options.limit);
    const filters=["s.workspace_id=?","r.status='APPLIED'"];const values: unknown[]=[workspaceId];
    if(options.sourceId){filters.push("r.source_id=?");values.push(options.sourceId);}
    if(options.cursor){const date=new Date(options.cursor.completedAt);if(Number.isNaN(date.getTime())) throw new Error("Invalid run cursor.");filters.push("(r.completed_at<? OR (r.completed_at=? AND r.id<?))");values.push(date,date,options.cursor.runId);}
    values.push(options.limit);
    const rows=await this.connection.query<DbRow[]>(`SELECT r.* FROM sync_runs r JOIN knowledge_sources s ON s.id=r.source_id WHERE ${filters.join(" AND ")} ORDER BY r.completed_at DESC,r.id DESC LIMIT ?`,values);
    return rows.map(mapSyncRun);
  }
}

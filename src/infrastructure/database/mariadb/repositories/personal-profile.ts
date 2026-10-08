import { readingDates } from "@/modules/personal/domain/reading-activity";
import type {PersonalProfileRepository,ProfileScope} from "@/modules/personal/ports/personal-profile-repository";
import type {PersonalProfileStats,ProfileDocumentFilter,ProfileDocument,ProfilePage,ProfileSyncFilter,ProfileSyncItem} from "@/modules/personal/domain/personal-profile";
import {asNumber,asNullableDate,type QueryConnection,type DbRow} from "./shared";
const active="d.status='ACTIVE' AND s.status='ACTIVE'";
const archived="(d.status='ARCHIVED' OR s.status='ARCHIVED')";
const favorite="JSON_CONTAINS(f.payload,'true','$.favorite')";
// Only the current published revision's recorded content changes count as unread.
// Legacy imports without a permanent change journal are not invented as events.
const unread=`s.source_type='FOLDER_SYNC' AND r.revision_no>COALESCE(p.revision_no,0) AND EXISTS (
 SELECT 1 FROM sync_run_changes c JOIN sync_runs run ON run.id=c.run_id AND run.status='APPLIED'
 WHERE c.document_id=d.id AND c.source_id=s.id AND c.workspace_id=s.workspace_id AND c.kind='DOCUMENT'
 AND c.after_revision_no=r.revision_no AND c.after_revision_no>COALESCE(c.before_revision_no,0)
 AND (JSON_CONTAINS(c.labels,'"ADDED"') OR JSON_CONTAINS(c.labels,'"UPDATED"')))`;
const documentsFrom=`FROM knowledge_documents d JOIN knowledge_sources s ON s.id=d.source_id
 JOIN knowledge_revisions r ON r.id=d.current_revision_id AND r.document_id=d.id
 LEFT JOIN personal_items f ON f.user_id=? AND f.workspace_id=s.workspace_id AND f.item_key=CONCAT('favorite:',d.id)
 LEFT JOIN document_read_progress p ON p.user_id=? AND p.workspace_id=s.workspace_id AND p.document_id=d.id
 WHERE s.workspace_id=?`;
const latestAttempt=`(SELECT status FROM sync_runs run WHERE run.source_id=s.id AND run.status IN ('APPLIED','FAILED') ORDER BY run.started_at DESC,run.id DESC LIMIT 1)`;
const lastSuccessful=`(SELECT MAX(completed_at) FROM sync_runs run WHERE run.source_id=s.id AND run.status='APPLIED')`;
const pendingFrom=`FROM source_import_snapshots i LEFT JOIN knowledge_sources s ON s.id=i.source_id AND s.workspace_id=i.workspace_id
 WHERE i.workspace_id=? AND i.created_by=? AND i.state='READY' AND i.has_blockers=0 AND i.expires_at>?
 AND (i.source_id IS NULL OR (s.status='ACTIVE' AND s.source_type='FOLDER_SYNC' AND i.based_on_version=s.sync_version))`;
function count(row:DbRow,key:string){return asNumber(row[key]??0,`profile ${key}`);}
function changePredicate(label:string){return `EXISTS (SELECT 1 FROM sync_run_changes c JOIN sync_runs run ON run.id=c.run_id AND run.status='APPLIED' WHERE c.document_id=d.id AND c.source_id=s.id AND c.workspace_id=s.workspace_id AND c.kind='DOCUMENT' AND JSON_CONTAINS(c.labels,'"${label}"') AND run.completed_at>=? AND run.completed_at<=?)`;}
function documentPredicate(filter:ProfileDocumentFilter):string {
  switch(filter){case "all":return active;case "synced":return `${active} AND s.source_type='FOLDER_SYNC'`;case "notes":return `${active} AND s.ownership='HUB_MANAGED'`;case "favorites":return `${active} AND ${favorite}`;case "unread":return `${active} AND ${unread}`;case "archived":return archived;case "added":return changePredicate("ADDED");case "updated":return changePredicate("UPDATED");case "recent-archived":return changePredicate("ARCHIVED");}
}
function documentParameters(scope:ProfileScope,filter:ProfileDocumentFilter){return [scope.userId,scope.userId,scope.workspaceId,...(["added","updated","recent-archived"].includes(filter)?[scope.since,scope.now]:[])];}
function page<T>(rows:T[],total:number,cursor:(item:T)=>string):ProfilePage<T>{const items=rows.slice(0,50);return {items,total,nextCursor:rows.length>50?cursor(items[items.length-1]):null};}
export class MariaDbPersonalProfileRepository implements PersonalProfileRepository {
  constructor(private readonly connection:QueryConnection){}
  async overview(scope:ProfileScope):Promise<PersonalProfileStats>{
    const dates = readingDates(scope.now, Math.round((scope.now.getTime() - scope.since.getTime()) / 86400000));
    // One statement gives every statistic the same InnoDB read view, even during sync.
    const rows=await this.connection.query<DbRow[]>(`WITH article_stats AS (SELECT
     COALESCE(SUM(${active}),0) articles,
     COALESCE(SUM(${active} AND s.source_type='FOLDER_SYNC'),0) synced,
     COALESCE(SUM(${active} AND s.ownership='HUB_MANAGED'),0) notes,
     COALESCE(SUM(${archived}),0) archived,
     COALESCE(SUM(${active} AND ${favorite}),0) favorites,
     COUNT(DISTINCT CASE WHEN ${active} AND p.document_id IS NOT NULL THEN d.id END) browsed,
     COUNT(DISTINCT CASE WHEN ${active} AND s.source_type='FOLDER_SYNC' AND p.document_id IS NOT NULL THEN d.id END) synced_browsed,
     COALESCE(SUM(${active} AND ${unread}),0) unread ${documentsFrom}),
sync_stats AS (SELECT COUNT(*) folders,COALESCE(SUM(last_status='APPLIED'),0) successful,COALESCE(SUM(last_status='FAILED'),0) failed,COALESCE(SUM(last_status IS NULL),0) never_synced FROM (SELECT s.id,${latestAttempt} last_status FROM knowledge_sources s WHERE s.workspace_id=? AND s.status='ACTIVE' AND s.source_type='FOLDER_SYNC') states),
pending_stats AS (SELECT COUNT(*) total ${pendingFrom}),
source_stats AS (SELECT s.id,s.name,COUNT(d.id) articles,COUNT(p.document_id) viewed,${lastSuccessful} last_synced_at FROM knowledge_sources s LEFT JOIN knowledge_documents d ON d.source_id=s.id AND d.status='ACTIVE' AND d.current_revision_id IS NOT NULL LEFT JOIN document_read_progress p ON p.user_id=? AND p.workspace_id=s.workspace_id AND p.document_id=d.id WHERE s.workspace_id=? AND s.status='ACTIVE' AND s.source_type='FOLDER_SYNC' GROUP BY s.id,s.name ORDER BY articles DESC,s.name,s.id LIMIT 3),
change_stats AS (SELECT
     COUNT(DISTINCT CASE WHEN JSON_CONTAINS(c.labels,'"ADDED"') THEN c.document_id END) added,
     COUNT(DISTINCT CASE WHEN JSON_CONTAINS(c.labels,'"UPDATED"') THEN c.document_id END) updated,
     COUNT(DISTINCT CASE WHEN JSON_CONTAINS(c.labels,'"ARCHIVED"') THEN c.document_id END) archived
     FROM sync_run_changes c JOIN sync_runs run ON run.id=c.run_id AND run.status='APPLIED'
     JOIN knowledge_documents d ON d.id=c.document_id AND d.source_id=c.source_id AND d.current_revision_id IS NOT NULL
     JOIN knowledge_sources s ON s.id=c.source_id AND s.workspace_id=c.workspace_id
     WHERE c.workspace_id=? AND c.kind='DOCUMENT' AND run.completed_at>=? AND run.completed_at<=?),
legacy_stats AS (SELECT EXISTS(SELECT 1 FROM sync_runs run JOIN knowledge_sources s ON s.id=run.source_id WHERE s.workspace_id=? AND run.status='APPLIED' AND run.completed_at>=? AND run.completed_at<=? AND COALESCE(JSON_CONTAINS(run.summary,'false','$.changed'),0)=0 AND NOT EXISTS(SELECT 1 FROM sync_run_changes c WHERE c.run_id=run.id)) missing)
SELECT article_stats.*,sync_stats.*,pending_stats.total pending_total,
 change_stats.added changed_added,change_stats.updated changed_updated,change_stats.archived changed_archived,legacy_stats.missing,
 (SELECT COUNT(DISTINCT document_id) FROM document_read_activity WHERE user_id=? AND workspace_id=? AND activity_date BETWEEN ? AND ? AND opened_at<=?) reading_articles,
 (SELECT JSON_ARRAYAGG(JSON_OBJECT('date',DATE_FORMAT(activity_date,'%Y-%m-%d'),'articles',articles)) FROM
   (SELECT activity_date,COUNT(*) articles FROM document_read_activity WHERE user_id=? AND workspace_id=? AND activity_date BETWEEN ? AND ? AND opened_at<=? GROUP BY activity_date) daily) reading_daily,
 (SELECT started_at FROM reading_activity_tracking WHERE id=1) tracked_since,
 (SELECT JSON_ARRAYAGG(JSON_OBJECT('id',id,'name',name,'articles',articles,'viewed',viewed,'last_synced_at',DATE_FORMAT(last_synced_at,'%Y-%m-%dT%H:%i:%s.%fZ')) ORDER BY articles DESC,name,id) FROM source_stats) source_json
 FROM article_stats CROSS JOIN sync_stats CROSS JOIN pending_stats CROSS JOIN change_stats CROSS JOIN legacy_stats`,[scope.userId,scope.userId,scope.workspaceId,scope.workspaceId,scope.workspaceId,scope.userId,scope.now,scope.userId,scope.workspaceId,scope.workspaceId,scope.since,scope.now,scope.workspaceId,scope.since,scope.now,scope.userId,scope.workspaceId,dates[0],dates.at(-1),scope.now,scope.userId,scope.workspaceId,dates[0],dates.at(-1),scope.now]);
    const row=rows[0],syncRow=row;
    const pending=[{total:row.pending_total}];
    const changes=[{added:row.changed_added,updated:row.changed_updated,archived:row.changed_archived}];
    const legacy=[{missing:row.missing}];
    const sources:DbRow[]=typeof row.source_json==='string'?JSON.parse(row.source_json):row.source_json??[];
    const dailyRows: { date: string; articles: number }[] = typeof row.reading_daily === "string" ? JSON.parse(row.reading_daily) : row.reading_daily ?? [];
    const daily = dates.map(date => ({date, articles: Number(dailyRows.find(item => item.date === date)?.articles ?? 0)}));
    return {reading: {articles: count(row,"reading_articles"), activeDays: daily.filter(day => day.articles > 0).length, trackedSince: asNullableDate(row.tracked_since)?.toISOString() ?? null, daily},counts:{articles:count(row,"articles"),synced:count(row,"synced"),notes:count(row,"notes"),archived:count(row,"archived"),folders:count(syncRow,"folders"),favorites:count(row,"favorites"),unread:count(row,"unread"),browsed:count(row,"browsed"),syncedBrowsed:count(row,"synced_browsed")},changes:{added:count(changes[0],"added"),updated:count(changes[0],"updated"),archived:count(changes[0],"archived")},sync:{successful:count(syncRow,"successful"),failed:count(syncRow,"failed"),neverSynced:count(syncRow,"never_synced"),pending:count(pending[0],"total")},sources:sources.map(source=>({sourceId:String(source.id),name:String(source.name),articles:count(source,"articles"),viewed:count(source,"viewed"),lastSyncedAt:asNullableDate(source.last_synced_at)?.toISOString()??null})),legacyChangesUnavailable:Boolean(count(legacy[0],"missing"))};
  }
  async documents(scope:ProfileScope,filter:ProfileDocumentFilter,after?:string):Promise<ProfilePage<ProfileDocument>>{
    const from=`${documentsFrom} AND (${documentPredicate(filter)})`,params=documentParameters(scope,filter);
    const rows=await this.connection.query<DbRow[]>(`WITH filtered AS (SELECT d.id,s.id source_id,r.title,s.name source_name,(${archived}) archived,(SELECT source_path FROM source_entries e WHERE e.source_id=s.id AND e.document_id=d.id AND e.entry_type='DOCUMENT' ORDER BY e.id LIMIT 1) source_path ${from}), totals AS (SELECT COUNT(*) total FROM filtered), items AS (SELECT * FROM filtered ${after?"WHERE id>?":""} ORDER BY id LIMIT 51) SELECT totals.total,items.* FROM totals LEFT JOIN items ON TRUE ORDER BY items.id`,[...params,...(after?[after]:[])]);
    return page(rows.filter(row=>row.id!=null).map(row=>({documentId:String(row.id),sourceId:String(row.source_id),title:String(row.title),sourceName:String(row.source_name),sourcePath:row.source_path==null?null:String(row.source_path),archived:Boolean(count(row,"archived"))})),count(rows[0],"total"),d=>d.documentId);
  }
  async syncItems(scope:ProfileScope,filter:ProfileSyncFilter,after?:string):Promise<ProfilePage<ProfileSyncItem>>{
    const pending=filter==="pending";
    const from=pending?pendingFrom:`FROM knowledge_sources s WHERE s.workspace_id=? AND s.status='ACTIVE' AND s.source_type='FOLDER_SYNC' ${filter==="folders"?"":`AND ${latestAttempt}=?`}`;
    const params=pending?[scope.workspaceId,scope.userId,scope.now]:[scope.workspaceId,...(filter==="folders"?[]:[filter==="successful"?"APPLIED":"FAILED"])];
    const select=pending?"i.id,i.source_id,COALESCE(s.name,i.proposed_source_name,i.root_name) name,i.id preview_id,NULL last_synced_at":`s.id,s.id source_id,s.name,NULL preview_id,${lastSuccessful} last_synced_at`;
    const rows=await this.connection.query<DbRow[]>(`WITH filtered AS (SELECT ${select} ${from}), totals AS (SELECT COUNT(*) total FROM filtered), items AS (SELECT * FROM filtered ${after?"WHERE id>?":""} ORDER BY id LIMIT 51) SELECT totals.total,items.* FROM totals LEFT JOIN items ON TRUE ORDER BY items.id`,[...params,...(after?[after]:[])]);
    return page(rows.filter(row=>row.id!=null).map(row=>({id:String(row.id),sourceId:row.source_id==null?null:String(row.source_id),name:String(row.name),previewId:row.preview_id==null?null:String(row.preview_id),lastSyncedAt:asNullableDate(row.last_synced_at)?.toISOString()??null})),count(rows[0],"total"),item=>item.id);
  }
}

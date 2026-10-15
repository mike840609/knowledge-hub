import type { CollectionCursor, CollectionItemView, KnowledgeCollection, KnowledgeCollectionItem } from "@/modules/knowledge/domain/knowledge-collection";
import type { QueryConnection, DbRow } from "./shared";
import { asDate, asNullableDate, asNumber } from "./shared";

export function collectionFromRow(row: DbRow): KnowledgeCollection {
  return {
    id:String(row.id),workspaceId:String(row.workspace_id),name:String(row.name),
    description:String(row.description),version:asNumber(row.version,"collection version"),
    status:String(row.status) as "ACTIVE"|"ARCHIVED",createdBy:String(row.created_by),
    updatedBy:String(row.updated_by),archivedBy:row.archived_by==null?null:String(row.archived_by),
    archivedAt:asNullableDate(row.archived_at),
    createdAt:asDate(row.created_at),updatedAt:asDate(row.updated_at),
  };
}

export function itemFromRow(row: DbRow): KnowledgeCollectionItem {
  return {
    id:String(row.id),collectionId:String(row.collection_id),documentId:String(row.document_id),
    position:asNumber(row.position,"item position"),readingNote:String(row.reading_note),
    addedAt:asDate(row.added_at),
  };
}

export async function listCollections(
  db: QueryConnection, workspaceId:string,status:"ACTIVE"|"ARCHIVED",
  cursor:CollectionCursor|null,limit:number,
): Promise<Array<KnowledgeCollection & {availableItems:number;totalItems:number}>> {
  const rows=await db.query<DbRow[]>(`SELECT c.*,
    (SELECT COUNT(*) FROM knowledge_collection_items i WHERE i.collection_id=c.id) AS total_items,
    (SELECT COUNT(*) FROM knowledge_collection_items i
      JOIN knowledge_documents d ON d.id=i.document_id AND d.status='ACTIVE'
      JOIN knowledge_sources s ON s.id=d.source_id AND s.status='ACTIVE' AND s.workspace_id=c.workspace_id
      JOIN knowledge_revisions r ON r.id=d.current_revision_id AND r.document_id=d.id
      WHERE i.collection_id=c.id) AS available_items
    FROM knowledge_collections c
    WHERE c.workspace_id=? AND c.status=?
      AND (? IS NULL OR c.updated_at<? OR (c.updated_at=? AND c.id<?))
    ORDER BY c.updated_at DESC,c.id DESC LIMIT ?`,
    [workspaceId,status,cursor?.updatedAt??null,cursor?.updatedAt??null,cursor?.updatedAt??null,cursor?.id??null,limit],
  );
  return rows.map(r=>({...collectionFromRow(r),
    availableItems:asNumber(r.available_items,"available items"),
    totalItems:asNumber(r.total_items,"total items")}));
}

export async function resolveCollectionItems(
  db:QueryConnection,collectionId:string,workspaceId:string,
):Promise<CollectionItemView[]> {
  const rows=await db.query<DbRow[]>(`SELECT i.id,i.position,i.reading_note,
      CASE WHEN s.id IS NOT NULL AND r.id IS NOT NULL THEN 1 ELSE 0 END AS visible,
      r.title AS visible_title,s.name AS visible_source_name,s.id AS visible_source_id,
      d.id AS visible_document_id
    FROM knowledge_collection_items i
    LEFT JOIN knowledge_documents d ON d.id=i.document_id AND d.status='ACTIVE'
    LEFT JOIN knowledge_sources s ON s.id=d.source_id
      AND s.status='ACTIVE' AND s.workspace_id=?
    LEFT JOIN knowledge_revisions r ON r.id=d.current_revision_id AND r.document_id=d.id
    WHERE i.collection_id=? ORDER BY i.position ASC,i.id ASC`,
    [workspaceId,collectionId]);
  return rows.map(row=>{
    const id=String(row.id),position=asNumber(row.position,"item position");
    if(Number(row.visible)!==1)return {id,position,state:"unavailable"};
    return {id,position,state:"available",documentId:String(row.visible_document_id),
      sourceId:String(row.visible_source_id),sourceName:String(row.visible_source_name),
      title:String(row.visible_title),readingNote:String(row.reading_note)};
  });
}

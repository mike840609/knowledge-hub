import type { KnowledgeCollection, KnowledgeCollectionItem, CollectionCursor, CollectionItemView } from "@/modules/knowledge/domain/knowledge-collection";
import type { KnowledgeCollectionRepository } from "@/modules/knowledge/ports/knowledge-collection-repository";
import type { DbRow, QueryConnection } from "./shared";
import { asNumber } from "./shared";
import { collectionFromRow, itemFromRow, listCollections, resolveCollectionItems } from "./knowledge-collection-reads";

export class MariaDbKnowledgeCollectionRepository implements KnowledgeCollectionRepository {
  constructor(private readonly db:QueryConnection) {}

  async findById(id:string):Promise<KnowledgeCollection|null> {
    const rows=await this.db.query<DbRow[]>("SELECT * FROM knowledge_collections WHERE id=?",[id]);
    return rows[0]?collectionFromRow(rows[0]):null;
  }
  async lockById(id:string):Promise<KnowledgeCollection|null> {
    const rows=await this.db.query<DbRow[]>("SELECT * FROM knowledge_collections WHERE id=? FOR UPDATE",[id]);
    return rows[0]?collectionFromRow(rows[0]):null;
  }
  async insert(c:KnowledgeCollection):Promise<void> {
    await this.db.query(`INSERT INTO knowledge_collections
      (id,workspace_id,name,description,version,status,created_by,updated_by,archived_by,archived_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [c.id,c.workspaceId,c.name,c.description,c.version,c.status,c.createdBy,c.updatedBy,c.archivedBy,c.archivedAt,c.createdAt,c.updatedAt]);
  }
  listByWorkspace(workspaceId:string,status:"ACTIVE"|"ARCHIVED",cursor:CollectionCursor|null,limit:number):Promise<Array<KnowledgeCollection & {availableItems:number;totalItems:number}>> {
    return listCollections(this.db,workspaceId,status,cursor,limit);
  }
  async listItems(collectionId:string):Promise<KnowledgeCollectionItem[]> {
    const rows=await this.db.query<DbRow[]>(
      "SELECT * FROM knowledge_collection_items WHERE collection_id=? ORDER BY position ASC,id ASC",[collectionId]);
    return rows.map(itemFromRow);
  }
  resolveItems(collectionId:string,workspaceId:string):Promise<CollectionItemView[]> {
    return resolveCollectionItems(this.db,collectionId,workspaceId);
  }
  async insertItem(i:KnowledgeCollectionItem):Promise<void> {
    await this.db.query(`INSERT INTO knowledge_collection_items
      (id,collection_id,document_id,position,reading_note,added_at) VALUES (?,?,?,?,?,?)`,
      [i.id,i.collectionId,i.documentId,i.position,i.readingNote,i.addedAt]);
  }
  async updateItemNote(itemId:string,note:string):Promise<void> {
    await this.db.query("UPDATE knowledge_collection_items SET reading_note=? WHERE id=?",[note,itemId]);
  }
  async deleteItem(itemId:string):Promise<void> {
    await this.db.query("DELETE FROM knowledge_collection_items WHERE id=?",[itemId]);
  }
  async replacePositions(collectionId:string,items:readonly {id:string;position:number}[]):Promise<void> {
    for(const item of items){
      await this.db.query("UPDATE knowledge_collection_items SET position=? WHERE collection_id=? AND id=?",
        [item.position,collectionId,item.id]);
    }
  }
  async saveMetadata(c:KnowledgeCollection):Promise<void> {
    await this.db.query(`UPDATE knowledge_collections SET
      name=?,description=?,version=?,status=?,updated_by=?,archived_by=?,archived_at=?,updated_at=? WHERE id=?`,
      [c.name,c.description,c.version,c.status,c.updatedBy,c.archivedBy,c.archivedAt,c.updatedAt,c.id]);
  }
  async countItems(collectionId:string):Promise<number> {
    const rows=await this.db.query<DbRow[]>(
      "SELECT COUNT(*) AS total FROM knowledge_collection_items WHERE collection_id=?",[collectionId]);
    return asNumber(rows[0]?.total??0,"item count");
  }
}

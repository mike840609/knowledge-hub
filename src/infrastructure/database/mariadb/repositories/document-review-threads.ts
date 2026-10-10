import type { ReviewThread, ReviewVisibility, ReviewStatus } from "@/modules/knowledge/domain/document-review";
import { asDate, asNullableDate, asNumber, type DbRow, type QueryConnection } from "./shared";
import type { DocumentReviewThreadRepository } from "@/modules/knowledge/ports/document-review-thread-repository";
function map(row:DbRow):ReviewThread { return {
 id: String(row.id),
 documentId: String(row.document_id),
 createdRevisionId: String(row.created_revision_id),
 createdBy: String(row.created_by),
 creationIdempotencyKey: String(row.creation_idempotency_key),
 creationRequestHash: String(row.creation_request_hash),
 originShareLinkId: row.origin_share_link_id === null ? null : String(row.origin_share_link_id),
 anchor: (typeof row.anchor_json === "string" ? JSON.parse(row.anchor_json) : row.anchor_json),
 status: String(row.status) as ReviewThread["status"],
 visibility: String(row.visibility) as ReviewThread["visibility"],
 hiddenBy: row.hidden_by === null ? null : String(row.hidden_by),
 hiddenAt: asNullableDate(row.hidden_at),
 hiddenReason: row.hidden_reason === null ? null : String(row.hidden_reason),
 resolvedBy: row.resolved_by === null ? null : String(row.resolved_by),
 resolvedAt: asNullableDate(row.resolved_at),
 createdAt: asDate(row.created_at),
 updatedAt: asDate(row.updated_at),
};}
export class MariaDbDocumentReviewThreadsRepository implements DocumentReviewThreadRepository {
 constructor(private readonly connection:QueryConnection){}
 async insert(value:ReviewThread):Promise<void>{ await this.connection.query("INSERT INTO document_review_threads (id,document_id,created_revision_id,created_by,creation_idempotency_key,creation_request_hash,origin_share_link_id,anchor_json,status,visibility,hidden_by,hidden_at,hidden_reason,resolved_by,resolved_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",[value.id,value.documentId,value.createdRevisionId,value.createdBy,value.creationIdempotencyKey,value.creationRequestHash,value.originShareLinkId,JSON.stringify(value.anchor),value.status,value.visibility,value.hiddenBy,value.hiddenAt,value.hiddenReason,value.resolvedBy,value.resolvedAt,value.createdAt,value.updatedAt]); }
 private async find(sql:string,values:unknown[]):Promise<ReviewThread|null>{const rows=await this.connection.query<DbRow[]>(sql,values);return rows[0]?map(rows[0]):null;}
 async findById(id:string){return this.find("SELECT * FROM document_review_threads WHERE id=?",[id]);}
 async lockById(id:string){return this.find("SELECT * FROM document_review_threads WHERE id=? FOR UPDATE",[id]);}
 async findByCreationKey(documentId:string,authorId:string,key:string){return this.find("SELECT * FROM document_review_threads WHERE document_id=? AND created_by=? AND creation_idempotency_key=?",[documentId,authorId,key]);}
 async listByDocument(documentId:string){const rows=await this.connection.query<DbRow[]>("SELECT * FROM document_review_threads WHERE document_id=? ORDER BY created_at,id",[documentId]);return rows.map(map);}
 async countVisibleByDocument(documentId:string){const rows=await this.connection.query<DbRow[]>("SELECT COUNT(*) AS n FROM document_review_threads WHERE document_id=? AND visibility='VISIBLE'",[documentId]);return asNumber(rows[0].n,"thread count");}
 async countVisibleOpenByCreator(documentId:string,creatorId:string){const rows=await this.connection.query<DbRow[]>("SELECT COUNT(*) AS n FROM document_review_threads WHERE document_id=? AND created_by=? AND visibility='VISIBLE' AND status='OPEN'",[documentId,creatorId]);return asNumber(rows[0].n,"creator thread count");}
 async setResolution(id:string,status:ReviewStatus,actorId:string,at:Date){await this.connection.query("UPDATE document_review_threads SET status=?,resolved_by=?,resolved_at=?,updated_at=? WHERE id=?",[status,status==="RESOLVED"?actorId:null,status==="RESOLVED"?at:null,at,id]);}
 async setVisibility(id:string,visibility:ReviewVisibility,actorId:string,at:Date,reason:string|null){
 await this.connection.query("UPDATE document_review_threads SET visibility=?,hidden_by=?,hidden_at=?,hidden_reason=?,updated_at=? WHERE id=?",[visibility,visibility==="HIDDEN"?actorId:null,visibility==="HIDDEN"?at:null,visibility==="HIDDEN"?reason:null,at,id]);
 }
}

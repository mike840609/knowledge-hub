import type { ReviewComment, ReviewVisibility } from "@/modules/knowledge/domain/document-review";
import { asDate, asNullableDate, asNumber, type DbRow, type QueryConnection } from "./shared";
import { IntegrityViolationError } from "@/modules/knowledge/domain/errors";
import type { DocumentReviewCommentRepository } from "@/modules/knowledge/ports/document-review-comment-repository";
function map(row:DbRow):ReviewComment { return {
 id: String(row.id),
 threadId: String(row.thread_id),
 authorUserId: String(row.author_user_id),
 body: String(row.body),
 visibility: String(row.visibility) as ReviewComment["visibility"],
 hiddenBy: row.hidden_by === null ? null : String(row.hidden_by),
 hiddenAt: asNullableDate(row.hidden_at),
 hiddenReason: row.hidden_reason === null ? null : String(row.hidden_reason),
 createdAt: asDate(row.created_at),
 idempotencyKey: String(row.idempotency_key),
 requestHash: String(row.request_hash),
};}
export class MariaDbDocumentReviewCommentsRepository implements DocumentReviewCommentRepository {
 constructor(private readonly connection:QueryConnection){}
 async insert(value:ReviewComment):Promise<void>{ if(value.visibility === "HIDDEN" && await this.countByThread(value.threadId) === 0) throw new IntegrityViolationError("The initial comment must remain visible."); await this.connection.query("INSERT INTO document_review_comments (id,thread_id,author_user_id,body,visibility,hidden_by,hidden_at,hidden_reason,created_at,idempotency_key,request_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?)",[value.id,value.threadId,value.authorUserId,value.body,value.visibility,value.hiddenBy,value.hiddenAt,value.hiddenReason,value.createdAt,value.idempotencyKey,value.requestHash]); }
 private async find(sql:string,values:unknown[]):Promise<ReviewComment|null>{const rows=await this.connection.query<DbRow[]>(sql,values);return rows[0]?map(rows[0]):null;}
 async findById(id:string){return this.find("SELECT * FROM document_review_comments WHERE id=?",[id]);}
 async findByReplyKey(threadId:string,authorId:string,key:string){return this.findByIdempotencyKey(threadId,authorId,key);}
 async countReplies(threadId:string){return Math.max(0,await this.countByThread(threadId)-1);}
 async findByIdempotencyKey(threadId:string,authorId:string,key:string){return this.find("SELECT * FROM document_review_comments WHERE thread_id=? AND author_user_id=? AND idempotency_key=?",[threadId,authorId,key]);}
 async listByThread(threadId:string){const rows=await this.connection.query<DbRow[]>("SELECT * FROM document_review_comments WHERE thread_id=? ORDER BY created_at,id",[threadId]);return rows.map(map);}
 async countByThread(threadId:string){const rows=await this.connection.query<DbRow[]>("SELECT COUNT(*) AS n FROM document_review_comments WHERE thread_id=?",[threadId]);return asNumber(rows[0].n,"comment count");}
 async setVisibility(id:string,visibility:ReviewVisibility,actorId:string,at:Date,reason:string|null){
 const comment=await this.findById(id);if(!comment)throw new IntegrityViolationError("Comment not found."); const first=(await this.listByThread(comment.threadId))[0]; if(visibility==="HIDDEN"&&first?.id===id)throw new IntegrityViolationError("Hide the thread to hide its initial comment.");
 await this.connection.query("UPDATE document_review_comments SET visibility=?,hidden_by=?,hidden_at=?,hidden_reason=? WHERE id=?",[visibility,visibility==="HIDDEN"?actorId:null,visibility==="HIDDEN"?at:null,visibility==="HIDDEN"?reason:null,id]);
 }
}

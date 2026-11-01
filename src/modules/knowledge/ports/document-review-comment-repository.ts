import type { ReviewComment, ReviewVisibility } from "../domain/document-review";
export interface DocumentReviewCommentRepository {
 insert(comment:ReviewComment):Promise<void>;
 findById(id:string):Promise<ReviewComment|null>;
 findByIdempotencyKey(threadId:string,authorId:string,key:string):Promise<ReviewComment|null>;
 findByIds(ids:readonly string[]):Promise<ReviewComment[]>;
 /** Comment id to its thread, without reading any body: enough to judge access before loading words. */
 listThreadIdsByCommentIds(ids:readonly string[]):Promise<{commentId:string;threadId:string}[]>;
 listByThread(threadId:string):Promise<ReviewComment[]>;
 listByThreads(threadIds:string[]):Promise<ReviewComment[]>;
 countByThread(threadId:string):Promise<number>;
 setBody(id:string,body:string,at:Date):Promise<void>;
 markDeleted(id:string,at:Date):Promise<void>;
 setVisibility(id:string,visibility:ReviewVisibility,actorId:string,at:Date,reason:string|null):Promise<void>;
}

import type { ReviewComment, ReviewVisibility } from "../domain/document-review";
export interface DocumentReviewCommentRepository {
 insert(comment:ReviewComment):Promise<void>;
 findById(id:string):Promise<ReviewComment|null>;
 findByIdempotencyKey(threadId:string,authorId:string,key:string):Promise<ReviewComment|null>;
 listByThread(threadId:string):Promise<ReviewComment[]>;
 countByThread(threadId:string):Promise<number>;
 setVisibility(id:string,visibility:ReviewVisibility,actorId:string,at:Date,reason:string|null):Promise<void>;
}

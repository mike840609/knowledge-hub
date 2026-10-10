import type { ReviewThread, ReviewStatus, ReviewVisibility } from "../domain/document-review";
export interface DocumentReviewThreadRepository {
 insert(thread:ReviewThread):Promise<void>;
 findById(id:string):Promise<ReviewThread|null>;
 lockById(id:string):Promise<ReviewThread|null>;
 findByCreationKey(documentId:string,authorId:string,key:string):Promise<ReviewThread|null>;
 listByDocument(documentId:string):Promise<ReviewThread[]>;
 countVisibleByDocument(documentId:string):Promise<number>;
 countVisibleOpenByCreator(documentId:string,creatorId:string):Promise<number>;
 setVisibility(id:string,visibility:ReviewVisibility,actorId:string,at:Date,reason:string|null):Promise<void>;
 setResolution(id:string,status:ReviewStatus,actorId:string,at:Date):Promise<void>;
}

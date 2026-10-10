export type ReviewWriteEvent = { id:string;userId:string;documentId:string;createdAt:Date };
export interface DocumentReviewWriteLedger {
 record(event:ReviewWriteEvent):Promise<void>;
 countSince(userId:string,documentId:string,since:Date):Promise<number>;
 countOlderThan(before:Date):Promise<number>;
 deleteOlderThan(before:Date,limit:number):Promise<number>;
}

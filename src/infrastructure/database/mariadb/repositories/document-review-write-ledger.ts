import type { DocumentReviewWriteLedger, ReviewWriteEvent } from "@/modules/knowledge/ports/document-review-write-ledger";
import { asNumber, affectedRows, type DbRow, type QueryConnection } from "./shared";
export class MariaDbDocumentReviewWriteLedger implements DocumentReviewWriteLedger {
 constructor(private readonly connection:QueryConnection){}
 async record(event:ReviewWriteEvent){await this.connection.query("INSERT INTO document_review_write_events (id,user_id,document_id,created_at) VALUES (?,?,?,?)",[event.id,event.userId,event.documentId,event.createdAt]);}
 async countSince(userId:string,documentId:string,since:Date){const rows=await this.connection.query<DbRow[]>("SELECT COUNT(*) AS n FROM document_review_write_events WHERE user_id=? AND document_id=? AND created_at>=?",[userId,documentId,since]);return asNumber(rows[0].n,"write count");}
 async countOlderThan(before:Date){const rows=await this.connection.query<DbRow[]>("SELECT COUNT(*) AS n FROM document_review_write_events WHERE created_at<?",[before]);return asNumber(rows[0].n,"expired write count");}
 async deleteOlderThan(before:Date,limit:number){if(!Number.isSafeInteger(limit)||limit<1||limit>1000)throw new Error("Cleanup batch size must be 1–1,000.");return affectedRows(await this.connection.query("DELETE FROM document_review_write_events WHERE created_at<? ORDER BY created_at,id LIMIT ?",[before,limit]));}
}

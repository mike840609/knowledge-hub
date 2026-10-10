import {afterAll,beforeAll,expect,it} from "vitest";
import type {Pool} from "mariadb";
import {databaseConfig} from "@/infrastructure/database/mariadb/config";
import {createDatabasePool} from "@/infrastructure/database/mariadb/pool";
let pool:Pool;
beforeAll(()=>{pool=createDatabasePool(databaseConfig("test"));});
afterAll(async()=>pool.end());
it("review schema has separate unique creation/reply keys and indexed ledger",async()=>{
 const rows=await pool.query("SELECT TABLE_NAME,INDEX_NAME,GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columns_csv,MIN(NON_UNIQUE) AS non_unique FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME LIKE 'document_review_%' GROUP BY TABLE_NAME,INDEX_NAME");
 expect(rows).toEqual(expect.arrayContaining([
 expect.objectContaining({TABLE_NAME:"document_review_threads",columns_csv:"document_id,created_by,creation_idempotency_key",non_unique:0}),
 expect.objectContaining({TABLE_NAME:"document_review_comments",columns_csv:"thread_id,author_user_id,idempotency_key",non_unique:0}),
 expect.objectContaining({TABLE_NAME:"document_review_write_events",columns_csv:"user_id,document_id,created_at"}),
 ]));
});
it("review records store no duplicated workspace/source scope",async()=>{
 const rows=await pool.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('document_review_threads','document_review_comments') AND COLUMN_NAME IN ('source_id','workspace_id')");expect(rows).toHaveLength(0);
});
it("review visibility and resolution have check constraints",async()=>{
 const rows=await pool.query("SELECT CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME IN ('document_review_threads','document_review_comments')");
 expect(rows.filter((r:{CHECK_CLAUSE:string})=>r.CHECK_CLAUSE.includes('hidden_at'))).toHaveLength(2);
 expect(rows.some((r:{CHECK_CLAUSE:string})=>r.CHECK_CLAUSE.includes('resolved_at'))).toBe(true);
});

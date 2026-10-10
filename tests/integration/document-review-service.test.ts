import type { KnowledgeUnitOfWork } from "@/modules/knowledge/ports/unit-of-work";
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { RandomShareTokenIssuer } from "@/infrastructure/security/random-share-token-issuer";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import { DocumentShareService } from "@/modules/knowledge/application/document-share-service";
import { DocumentReviewService } from "@/modules/knowledge/application/document-review-service";
import { HubKnowledgeCommandServiceImpl } from "@/modules/knowledge/application/hub-knowledge-command-service";
import { ensureDefaultHubSource } from "@/modules/sources/application/ensure-default-hub-source";
import { PersonalWorkspaceService } from "@/modules/workspaces/application/personal-workspace-service";
import type { ReviewAnchor } from "@/modules/knowledge/domain/document-review";
import { projectReviewBlocks } from "@/modules/knowledge/domain/review-anchor";
import { uuidv7 } from "@/shared/ids/uuidv7";
let pool:Pool;
beforeAll(()=>{pool=createDatabasePool(databaseConfig("test"));});afterAll(async()=>{await pool.end();});
async function fixture(){
 const uow=new MariaDbUnitOfWork(pool);const identity=(name:string)=>({id:uuidv7(),emp_id:randomUUID(),name,org_code:"REVIEW"});const owner=identity("Owner"),reviewer=identity("Reviewer");
 await uow.run(async r=>{await r.users.upsertIdentity(owner);await r.users.upsertIdentity(reviewer);});
 const {workspace}=await new PersonalWorkspaceService(uow).ensurePersonalWorkspace(owner.id);const caller=callerFromIdentity(owner),viewer=callerFromIdentity(reviewer);
 const sourceId=await ensureDefaultHubSource(uow,caller,workspace.id);const created=await new HubKnowledgeCommandServiceImpl(uow).createDocument(caller,{sourceId,parentId:null,title:"Review",markdown:"A secret passage here.",metadata:{}});
 const shares=new DocumentShareService(uow,new RandomShareTokenIssuer());const a=await shares.create(caller,{documentId:created.documentId});const b=await shares.create(caller,{documentId:created.documentId});const token=a.path.slice(3);
 const block=projectReviewBlocks("A secret passage here.")[0];const anchor:ReviewAnchor={schemaVersion:1,blockPath:block.path,blockKind:block.kind,startUtf16:2,endUtf16:16,exact:"secret passage",prefix:"A ",suffix:" here."};
 const service=new DocumentReviewService(uow,undefined,()=>true);const input={token,expectedRevisionId:created.revisionId,anchor,body:"PRIVATE COMMENT",idempotencyKey:randomUUID()};
 return {uow,caller,viewer,workspace,sourceId,...created,shares,a,b,token,service,input};
}
describe("document review security, idempotency and moderation",()=>{
 it("anonymous link reads share visible history, redact hidden content and stop at expiry or revocation",async()=>{
  const f=await fixture();const t=await f.service.createForLink(f.viewer,f.input);
  const query=await f.service.queryForLink(null,f.token);
  expect(query).toMatchObject({callerUserId:null,writesEnabled:false});expect(query.threads[0].id).toBe(t.id);
  const reply=await f.service.replyForOwner(f.caller,{documentId:f.documentId,threadId:t.id,body:"HIDDEN REPLY SECRET",idempotencyKey:randomUUID()});
  await f.service.setVisibility(f.caller,{documentId:f.documentId,threadId:t.id,commentId:reply.id,visibility:"HIDDEN",reason:"PRIVATE REASON"});
  const safe=JSON.stringify(await f.service.queryForLink(null,f.token));expect(safe).not.toContain("HIDDEN REPLY SECRET");expect(safe).not.toContain("PRIVATE REASON");
  await f.service.setVisibility(f.caller,{documentId:f.documentId,threadId:t.id,visibility:"HIDDEN"});expect((await f.service.queryForLink(null,f.token)).threads).toEqual([]);
  const expired=new DocumentReviewService(f.uow,()=>new Date("2100-01-01"));await expect(expired.queryForLink(null,f.token)).rejects.toMatchObject({code:"SHARE_LINK_NOT_FOUND"});
  await f.shares.revoke(f.caller,f.a.id);await expect(f.service.queryForLink(null,f.token)).rejects.toMatchObject({code:"SHARE_LINK_NOT_FOUND"});
 });
 it("serializes concurrent exact create/reply retries and rejects payload changes",async()=>{
  const f=await fixture();const results=await Promise.all([f.service.createForLink(f.viewer,f.input),f.service.createForLink(f.viewer,f.input)]);expect(results[0].id).toBe(results[1].id);
  const reordered={...f.input,anchor:Object.fromEntries(Object.entries(f.input.anchor).reverse()) as ReviewAnchor};expect((await f.service.createForLink(f.viewer,reordered)).id).toBe(results[0].id);
  await expect(f.service.createForLink(f.viewer,{...f.input,body:"different"})).rejects.toMatchObject({code:"IDEMPOTENCY_KEY_REUSED"});
  const reply={token:f.token,threadId:results[0].id,body:"reply",idempotencyKey:randomUUID()};const replies=await Promise.all([f.service.replyForLink(f.viewer,reply),f.service.replyForLink(f.viewer,reply)]);expect(replies[0].id).toBe(replies[1].id);
  expect(await f.uow.run(r=>r.reviewWriteLedger.countSince(f.viewer.identity.id,f.documentId,new Date(0)))).toBe(2);
 });
 it("shares discussions across links but hides revoked/cross-document access",async()=>{
  const f=await fixture();const t=await f.service.createForLink(f.viewer,f.input);expect((await f.service.listForLink(f.caller,f.b.path.slice(3)))[0].id).toBe(t.id);
  const other=await fixture();await expect(f.service.replyForLink(f.viewer,{token:other.token,threadId:t.id,body:"no",idempotencyKey:randomUUID()})).rejects.toMatchObject({code:"SHARE_LINK_NOT_FOUND"});
  await f.shares.revoke(f.caller,f.a.id);await expect(f.service.createForLink(f.viewer,f.input)).rejects.toMatchObject({code:"SHARE_LINK_NOT_FOUND"});expect(await f.service.listForOwner(f.caller,f.documentId)).toHaveLength(1);
  await expect(f.service.listForOwner(f.viewer,f.documentId)).rejects.toMatchObject({code:"SHARE_LINK_NOT_FOUND"});
 });
 it("hides opener via thread and suppresses secrets in reviewer JSON and audit",async()=>{
  const f=await fixture();const t=await f.service.createForLink(f.viewer,f.input);const reply=await f.service.replyForOwner(f.caller,{documentId:f.documentId,threadId:t.id,body:"SECOND SECRET",idempotencyKey:randomUUID()});
  await f.service.setVisibility(f.caller,{documentId:f.documentId,threadId:t.id,commentId:reply.id,visibility:"HIDDEN",reason:"SECRET REASON"});
  let visible=JSON.stringify(await f.service.listForLink(f.viewer,f.token));expect(visible).not.toContain("SECOND SECRET");expect(visible).not.toContain("SECRET REASON");
  await f.service.setVisibility(f.caller,{documentId:f.documentId,threadId:t.id,commentId:t.comments[0].id,visibility:"HIDDEN",reason:"SECRET REASON"});expect(await f.service.listForLink(f.viewer,f.token)).toEqual([]);
  expect((await f.uow.run(r=>r.reviewComments.findById(t.comments[0].id)))?.visibility).toBe("VISIBLE");
  await f.service.setVisibility(f.caller,{documentId:f.documentId,threadId:t.id,visibility:"VISIBLE"});visible=JSON.stringify(await f.service.listForLink(f.viewer,f.token));expect(visible).not.toContain("SECOND SECRET");
  const rows=await pool.query("SELECT payload FROM workspace_audit_events WHERE workspace_id=? AND event_type LIKE 'DOCUMENT_REVIEW_%'",[f.workspace.id]);const audits=JSON.stringify(rows);for(const secret of ["PRIVATE COMMENT","SECOND SECRET","SECRET REASON","secret passage",f.token])expect(audits).not.toContain(secret);
 });
 it("blocks resolved replies, permits archived owner moderation, and default disables new writes",async()=>{
  const f=await fixture();const t=await f.service.createForLink(f.viewer,f.input);await f.service.setResolution(f.caller,{documentId:f.documentId,threadId:t.id,status:"RESOLVED"});
  await expect(f.service.replyForOwner(f.caller,{documentId:f.documentId,threadId:t.id,body:"no",idempotencyKey:randomUUID()})).rejects.toMatchObject({code:"REVIEW_THREAD_CLOSED"});
  const disabled=new DocumentReviewService(f.uow);await expect(disabled.createForLink(f.viewer,{...f.input,idempotencyKey:randomUUID()})).rejects.toMatchObject({code:"REVIEW_WRITES_DISABLED"});
  await pool.query("UPDATE knowledge_documents SET status='ARCHIVED',archived_by=?,archived_at=? WHERE id=?",[f.caller.identity.id,new Date(),f.documentId]);expect(await f.service.listForOwner(f.caller,f.documentId)).toHaveLength(1);
  await f.service.setVisibility(f.caller,{documentId:f.documentId,threadId:t.id,visibility:"HIDDEN"});
  await expect(f.service.setResolution(f.caller,{documentId:f.documentId,threadId:t.id,status:"OPEN"})).rejects.toMatchObject({code:"REVIEW_CONFLICT"});
 });
 it("enforces persisted hourly and creator quotas, without charging idempotent retries",async()=>{
  const f=await fixture();const first=await f.service.createForLink(f.viewer,f.input);
  await f.uow.run(async r=>{for(let i=0;i<29;i++)await r.reviewWriteLedger.record({id:uuidv7(),userId:f.viewer.identity.id,documentId:f.documentId,createdAt:new Date()});});
  expect((await f.service.createForLink(f.viewer,f.input)).id).toBe(first.id);
  await expect(f.service.createForLink(f.viewer,{...f.input,idempotencyKey:randomUUID()})).rejects.toMatchObject({code:"REVIEW_RATE_LIMIT"});
  await pool.query("DELETE FROM document_review_write_events WHERE document_id=?",[f.documentId]);
  for(let i=1;i<20;i++)await f.service.createForLink(f.viewer,{...f.input,idempotencyKey:randomUUID()});
  await expect(f.service.createForLink(f.viewer,{...f.input,idempotencyKey:randomUUID()})).rejects.toMatchObject({code:"CAPACITY_EXCEEDED"});
  await f.service.setVisibility(f.caller,{documentId:f.documentId,threadId:first.id,visibility:"HIDDEN"});
  await f.service.createForLink(f.viewer,{...f.input,idempotencyKey:randomUUID()});
  await expect(f.service.setVisibility(f.caller,{documentId:f.documentId,threadId:first.id,visibility:"VISIBLE"})).rejects.toMatchObject({code:"CAPACITY_EXCEEDED"});
  expect((await f.service.listForOwner(f.caller,f.documentId)).find(t=>t.id===first.id)?.visibility).toBe("HIDDEN");
 });

 it("counts resolved visible threads toward document capacity and preserves failed unhide",async()=>{
  const f=await fixture();const t=await f.service.createForLink(f.viewer,f.input);
  await f.service.setVisibility(f.caller,{documentId:f.documentId,threadId:t.id,visibility:"HIDDEN"});
  await f.uow.run(async r=>{const original=(await r.reviewThreads.findById(t.id))!;for(let i=0;i<200;i++)await r.reviewThreads.insert({...original,id:uuidv7(),creationIdempotencyKey:randomUUID(),status:"RESOLVED",resolvedBy:f.caller.identity.id,resolvedAt:new Date(),visibility:"VISIBLE",hiddenBy:null,hiddenAt:null,hiddenReason:null});});
  await expect(f.service.createForLink(f.viewer,{...f.input,idempotencyKey:randomUUID()})).rejects.toMatchObject({code:"CAPACITY_EXCEEDED"});
  await expect(f.service.setVisibility(f.caller,{documentId:f.documentId,threadId:t.id,visibility:"VISIBLE"})).rejects.toMatchObject({code:"CAPACITY_EXCEEDED"});
  expect((await f.uow.run(r=>r.reviewThreads.findById(t.id)))?.visibility).toBe("HIDDEN");
 });
 it("counts hidden replies toward the lifetime reply cap",async()=>{
  const f=await fixture();const t=await f.service.createForLink(f.viewer,f.input);
  await f.uow.run(async r=>{for(let i=0;i<100;i++)await r.reviewComments.insert({id:uuidv7(),threadId:t.id,authorUserId:f.viewer.identity.id,body:"hidden",visibility:"HIDDEN",hiddenBy:f.caller.identity.id,hiddenAt:new Date(),hiddenReason:null,createdAt:new Date(),idempotencyKey:randomUUID(),requestHash:"a".repeat(64)});});
  await expect(f.service.replyForLink(f.viewer,{token:f.token,threadId:t.id,body:"too many",idempotencyKey:randomUUID()})).rejects.toMatchObject({code:"CAPACITY_EXCEEDED"});
  expect(await f.uow.run(r=>r.reviewComments.countByThread(t.id))).toBe(101);
 });
 it("rolls moderation back when its audit cannot persist",async()=>{
  const f=await fixture();const t=await f.service.createForLink(f.viewer,f.input);
  const failing:KnowledgeUnitOfWork={run:work=>f.uow.run(r=>work({...r,auditEvents:new Proxy(r.auditEvents,{get:(target,property,receiver)=>property==="append"?async()=>{throw new Error("audit failed");}:Reflect.get(target,property,receiver)})}))};
  await expect(new DocumentReviewService(failing).setVisibility(f.caller,{documentId:f.documentId,threadId:t.id,visibility:"HIDDEN"})).rejects.toThrow();
  expect((await f.uow.run(r=>r.reviewThreads.findById(t.id)))?.visibility).toBe("VISIBLE");
 });

 it("orders current anchors by document position and places outdated threads last",async()=>{
  const f=await fixture();const later=await f.service.createForLink(f.viewer,f.input);
  const earlier=await f.service.createForLink(f.viewer,{...f.input,idempotencyKey:randomUUID(),anchor:{...f.input.anchor,startUtf16:0,endUtf16:1,exact:"A",prefix:"",suffix:" secret passage here."}});
  await f.uow.run(async r=>{const original=(await r.reviewThreads.findById(later.id))!;await r.reviewThreads.insert({...original,id:uuidv7(),creationIdempotencyKey:randomUUID(),anchor:{...original.anchor,exact:"missing"},createdAt:new Date(0)});});
  const threads=await f.service.listForLink(f.viewer,f.token);expect(threads.map(t=>t.id).slice(0,2)).toEqual([earlier.id,later.id]);expect(threads[2].currentAnchor.match).toBe("OUTDATED");
 });

});

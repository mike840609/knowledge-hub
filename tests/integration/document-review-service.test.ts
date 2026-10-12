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
  // A link holder is told who wrote a comment by name, and is handed no ID that reaches past this document.
  expect(query.threads[0].comments[0].authorName).toBe("Reviewer");
  for(const id of [f.viewer.identity.id,f.caller.identity.id,f.documentId,f.sourceId,f.workspace.id,f.a.id])expect(JSON.stringify(query)).not.toContain(id);
  const reply=await f.service.replyForOwner(f.caller,{documentId:f.documentId,threadId:t.id,body:"HIDDEN REPLY SECRET",idempotencyKey:randomUUID()});
  await f.service.setVisibility(f.caller,{documentId:f.documentId,threadId:t.id,commentId:reply.id,visibility:"HIDDEN",reason:"PRIVATE REASON"});
  const safe=JSON.stringify(await f.service.queryForLink(null,f.token));expect(safe).not.toContain("HIDDEN REPLY SECRET");expect(safe).not.toContain("PRIVATE REASON");
  await f.service.setVisibility(f.caller,{documentId:f.documentId,threadId:t.id,visibility:"HIDDEN"});expect((await f.service.queryForLink(null,f.token)).threads).toEqual([]);
  const expired=new DocumentReviewService(f.uow,()=>new Date("2100-01-01"));await expect(expired.queryForLink(null,f.token)).rejects.toMatchObject({code:"SHARE_LINK_NOT_FOUND"});
  await f.shares.revoke(f.caller,f.a.id);await expect(f.service.queryForLink(null,f.token)).rejects.toMatchObject({code:"SHARE_LINK_NOT_FOUND"});
 });
 it("reads wait behind no writer: a held source, link and workspace do not block the anonymous or the owner's query",async()=>{
  const f=await fixture();const t=await f.service.createForLink(f.viewer,f.input);
  const holder=await pool.getConnection();
  try{
   await holder.beginTransaction();
   await holder.query("SELECT id FROM document_share_links WHERE token=? FOR UPDATE",[f.token]);
   await holder.query("SELECT id FROM knowledge_sources WHERE id=? FOR UPDATE",[f.sourceId]);
   await holder.query("SELECT id FROM workspaces WHERE id=? FOR UPDATE",[f.workspace.id]);
   const within=<T,>(work:Promise<T>)=>Promise.race([work,new Promise<"blocked">(resolve=>setTimeout(()=>resolve("blocked"),3000))]);
   const anonymous=await within(f.service.queryForLink(null,f.token));
   expect(anonymous).not.toBe("blocked");expect(anonymous).toMatchObject({threads:[{id:t.id}],callerUserId:null,writesEnabled:false});
   const owner=await within(f.service.queryForOwner(f.caller,f.documentId));
   expect(owner).not.toBe("blocked");expect(owner).toMatchObject({threads:[{id:t.id}]});
  }finally{await holder.rollback();await holder.release();}
 },15000);
 it("serializes concurrent exact create/reply retries and rejects payload changes",async()=>{
  const f=await fixture();const results=await Promise.all([f.service.createForLink(f.viewer,f.input),f.service.createForLink(f.viewer,f.input)]);expect(results[0].id).toBe(results[1].id);
  const reordered={...f.input,anchor:Object.fromEntries(Object.entries(f.input.anchor).reverse()) as ReviewAnchor};expect((await f.service.createForLink(f.viewer,reordered)).id).toBe(results[0].id);
  await expect(f.service.createForLink(f.viewer,{...f.input,body:"different"})).rejects.toMatchObject({code:"IDEMPOTENCY_KEY_REUSED"});
  const reply={token:f.token,threadId:results[0].id,body:"reply",idempotencyKey:randomUUID()};const replies=await Promise.all([f.service.replyForLink(f.viewer,reply),f.service.replyForLink(f.viewer,reply)]);expect(replies[0].id).toBe(replies[1].id);
  expect(await f.uow.run(r=>r.reviewWriteLedger.countSince(f.viewer.identity.id,f.documentId,new Date(0)))).toBe(2);
 });
 it("shares discussions across links but hides revoked/cross-document access",async()=>{
  const f=await fixture();const t=await f.service.createForLink(f.viewer,f.input);expect((await f.service.queryForLink(f.caller,f.b.path.slice(3))).threads[0].id).toBe(t.id);
  const other=await fixture();await expect(f.service.replyForLink(f.viewer,{token:other.token,threadId:t.id,body:"no",idempotencyKey:randomUUID()})).rejects.toMatchObject({code:"SHARE_LINK_NOT_FOUND"});
  await f.shares.revoke(f.caller,f.a.id);await expect(f.service.createForLink(f.viewer,f.input)).rejects.toMatchObject({code:"SHARE_LINK_NOT_FOUND"});expect((await f.service.queryForOwner(f.caller,f.documentId)).threads).toHaveLength(1);
  await expect(f.service.queryForOwner(f.viewer,f.documentId)).rejects.toMatchObject({code:"SHARE_LINK_NOT_FOUND"});
 });
 it("hides opener via thread and suppresses secrets in reviewer JSON and audit",async()=>{
  const f=await fixture();const t=await f.service.createForLink(f.viewer,f.input);const reply=await f.service.replyForOwner(f.caller,{documentId:f.documentId,threadId:t.id,body:"SECOND SECRET",idempotencyKey:randomUUID()});
  await f.service.setVisibility(f.caller,{documentId:f.documentId,threadId:t.id,commentId:reply.id,visibility:"HIDDEN",reason:"SECRET REASON"});
  let visible=JSON.stringify((await f.service.queryForLink(f.viewer,f.token)).threads);expect(visible).not.toContain("SECOND SECRET");expect(visible).not.toContain("SECRET REASON");
  await f.service.setVisibility(f.caller,{documentId:f.documentId,threadId:t.id,commentId:t.comments[0].id,visibility:"HIDDEN",reason:"SECRET REASON"});expect((await f.service.queryForLink(f.viewer,f.token)).threads).toEqual([]);
  expect((await f.uow.run(r=>r.reviewComments.findById(t.comments[0].id)))?.visibility).toBe("VISIBLE");
  await f.service.setVisibility(f.caller,{documentId:f.documentId,threadId:t.id,visibility:"VISIBLE"});visible=JSON.stringify((await f.service.queryForLink(f.viewer,f.token)).threads);expect(visible).not.toContain("SECOND SECRET");
  const rows=await pool.query("SELECT payload FROM workspace_audit_events WHERE workspace_id=? AND event_type LIKE 'DOCUMENT_REVIEW_%'",[f.workspace.id]);const audits=JSON.stringify(rows);for(const secret of ["PRIVATE COMMENT","SECOND SECRET","SECRET REASON","secret passage",f.token])expect(audits).not.toContain(secret);
 });
 it("blocks resolved replies, permits archived owner moderation, and default disables new writes",async()=>{
  const f=await fixture();const t=await f.service.createForLink(f.viewer,f.input);await f.service.setResolution(f.caller,{documentId:f.documentId,threadId:t.id,status:"RESOLVED"});
  await expect(f.service.replyForOwner(f.caller,{documentId:f.documentId,threadId:t.id,body:"no",idempotencyKey:randomUUID()})).rejects.toMatchObject({code:"REVIEW_THREAD_CLOSED"});
  const disabled=new DocumentReviewService(f.uow);await expect(disabled.createForLink(f.viewer,{...f.input,idempotencyKey:randomUUID()})).rejects.toMatchObject({code:"REVIEW_WRITES_DISABLED"});
  await pool.query("UPDATE knowledge_documents SET status='ARCHIVED',archived_by=?,archived_at=? WHERE id=?",[f.caller.identity.id,new Date(),f.documentId]);expect((await f.service.queryForOwner(f.caller,f.documentId)).threads).toHaveLength(1);
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
  expect((await f.service.queryForOwner(f.caller,f.documentId)).threads.find(t=>t.id===first.id)?.visibility).toBe("HIDDEN");
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
  const threads=(await f.service.queryForLink(f.viewer,f.token)).threads;expect(threads.map(t=>t.id).slice(0,2)).toEqual([earlier.id,later.id]);expect(threads[2].currentAnchor.match).toBe("OUTDATED");
 });

});

describe("the owner starts a discussion on their own document",()=>{
 const ownerInput=(f:Awaited<ReturnType<typeof fixture>>)=>({documentId:f.documentId,expectedRevisionId:f.input.expectedRevisionId,anchor:f.input.anchor,body:"OWNER NOTE",idempotencyKey:randomUUID()});
 it("without a link, and everyone the document is shared with reads it",async()=>{
  const f=await fixture();const t=await f.service.createForOwner(f.caller,ownerInput(f));
  expect(t).toMatchObject({status:"OPEN",createdBy:f.caller.identity.id,currentAnchor:{match:"MATCHED",anchor:{exact:"secret passage"}}});expect(t.comments.map(c=>c.body)).toEqual(["OWNER NOTE"]);
  expect((await f.uow.run(r=>r.reviewThreads.findById(t.id)))!.originShareLinkId).toBeNull();
  const shared=(await f.service.queryForLink(null,f.token)).threads;expect(shared.map(x=>x.id)).toEqual([t.id]);expect(shared[0].comments[0]).toMatchObject({body:"OWNER NOTE",authorName:"Owner"});
  // A reader of the link answers it as any other.
  await f.service.replyForLink(f.viewer,{token:f.token,threadId:t.id,body:"seen",idempotencyKey:randomUUID()});expect((await f.service.queryForOwner(f.caller,f.documentId)).threads[0].comments).toHaveLength(2);
 });
 it("with every link gone",async()=>{
  const f=await fixture();await f.shares.revoke(f.caller,f.a.id);await f.shares.revoke(f.caller,f.b.id);
  expect((await f.service.createForOwner(f.caller,ownerInput(f))).status).toBe("OPEN");
 });
 it("and nobody else does: knowing the document is not owning it",async()=>{
  const f=await fixture();
  await expect(f.service.createForOwner(f.viewer,ownerInput(f))).rejects.toMatchObject({code:"SHARE_LINK_NOT_FOUND"});
  const other=await fixture();await expect(f.service.createForOwner(other.caller,ownerInput(f))).rejects.toMatchObject({code:"SHARE_LINK_NOT_FOUND"});
  expect((await f.service.queryForOwner(f.caller,f.documentId)).threads).toHaveLength(0);
 });
 it("held to what a reader's is: one for a retried request, the current revision, a passage that is there, the limits, the switch, an active document",async()=>{
  const f=await fixture();const input=ownerInput(f);const first=await f.service.createForOwner(f.caller,input);
  expect((await f.service.createForOwner(f.caller,input)).id).toBe(first.id);
  await expect(f.service.createForOwner(f.caller,{...input,body:"different"})).rejects.toMatchObject({code:"IDEMPOTENCY_KEY_REUSED"});
  await expect(f.service.createForOwner(f.caller,{...ownerInput(f),expectedRevisionId:uuidv7()})).rejects.toMatchObject({code:"STALE_DOCUMENT_REVISION"});
  await expect(f.service.createForOwner(f.caller,{...ownerInput(f),anchor:{...f.input.anchor,exact:"not the passage"}})).rejects.toMatchObject({code:"VALIDATION_ERROR"});
  await expect(f.service.createForOwner(f.caller,{...ownerInput(f),body:" "})).rejects.toMatchObject({code:"VALIDATION_ERROR"});
  await expect(new DocumentReviewService(f.uow).createForOwner(f.caller,ownerInput(f))).rejects.toMatchObject({code:"REVIEW_WRITES_DISABLED"});
  for(let i=1;i<20;i++)await f.service.createForOwner(f.caller,ownerInput(f));
  await expect(f.service.createForOwner(f.caller,ownerInput(f))).rejects.toMatchObject({code:"CAPACITY_EXCEEDED"});
  const archived=await fixture();await pool.query("UPDATE knowledge_documents SET status='ARCHIVED',archived_by=?,archived_at=? WHERE id=?",[archived.caller.identity.id,new Date(),archived.documentId]);
  await expect(archived.service.createForOwner(archived.caller,ownerInput(archived))).rejects.toMatchObject({code:"REVIEW_CONFLICT"});
 });
});

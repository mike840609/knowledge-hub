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
 const shares=new DocumentShareService(uow,new RandomShareTokenIssuer());const a=await shares.create(caller,{documentId:created.documentId});const token=a.path.slice(3);
 const block=projectReviewBlocks("A secret passage here.")[0];const anchor:ReviewAnchor={schemaVersion:1,blockPath:block.path,blockKind:block.kind,startUtf16:2,endUtf16:16,exact:"secret passage",prefix:"A ",suffix:" here."};
 const service=new DocumentReviewService(uow,undefined,()=>true);
 const unread=()=>uow.run(r=>r.shareCommentEvents.listUnreadByRecipient(owner.id));
 return {uow,caller,viewer,workspace,sourceId,...created,shares,a,token,service,anchor,unread,owner,reviewer};
}
describe("share-comment notify: link-origin comments notify the owner",()=>{
 it("createForLink inserts one unread event with author and excerpt",async()=>{
  const f=await fixture();
  const t=await f.service.createForLink(f.viewer,{token:f.token,expectedRevisionId:f.revisionId,anchor:f.anchor,body:"PRIVATE COMMENT",idempotencyKey:randomUUID()});
  expect(await f.unread()).toHaveLength(1);
  const {notifications}=await f.service.listUnreadForOwner(f.caller);
  expect(notifications).toHaveLength(1);
  expect(notifications[0]).toMatchObject({documentId:f.documentId,threadId:t.id,documentTitle:"Review",authorName:"Reviewer",excerpt:"PRIVATE COMMENT"});
  expect(notifications[0].sourceId).toBe(f.sourceId);
 });
 it("owner writes, idempotent replays, edits, retractions and resolutions insert nothing",async()=>{
  const f=await fixture();
  const input={token:f.token,expectedRevisionId:f.revisionId,anchor:f.anchor,body:"PRIVATE COMMENT",idempotencyKey:randomUUID()};
  const t=await f.service.createForLink(f.viewer,input);
  await f.service.replyForOwner(f.caller,{documentId:f.documentId,threadId:t.id,body:"owner reply",idempotencyKey:randomUUID()});
  expect(await f.unread()).toHaveLength(1);
  await f.service.createForLink(f.viewer,input);
  expect(await f.unread()).toHaveLength(1);
  const reply=await f.service.replyForLink(f.viewer,{token:f.token,threadId:t.id,body:"second",idempotencyKey:randomUUID()});
  expect(await f.unread()).toHaveLength(2);
  await f.service.editForLink(f.viewer,{token:f.token,threadId:t.id,commentId:reply.id,body:"edited"});
  expect(await f.unread()).toHaveLength(2);
  await f.service.deleteForLink(f.viewer,{token:f.token,threadId:t.id,commentId:reply.id});
  expect(await f.unread()).toHaveLength(2);
  await f.service.setResolution(f.caller,{documentId:f.documentId,threadId:t.id,status:"RESOLVED"});
  expect(await f.unread()).toHaveLength(2);
 });
 it("hiding the thread afterwards removes its notification",async()=>{
  const f=await fixture();
  const t=await f.service.createForLink(f.viewer,{token:f.token,expectedRevisionId:f.revisionId,anchor:f.anchor,body:"PRIVATE COMMENT",idempotencyKey:randomUUID()});
  expect((await f.service.listUnreadForOwner(f.caller)).notifications).toHaveLength(1);
  await f.service.setVisibility(f.caller,{documentId:f.documentId,threadId:t.id,visibility:"HIDDEN",reason:"spam"});
  expect((await f.service.listUnreadForOwner(f.caller)).notifications).toHaveLength(0);
 });
 it("markDocumentRead clears the badge and refuses non-owners",async()=>{
  const f=await fixture();
  const t=await f.service.createForLink(f.viewer,{token:f.token,expectedRevisionId:f.revisionId,anchor:f.anchor,body:"PRIVATE COMMENT",idempotencyKey:randomUUID()});
  await f.service.markDocumentRead(f.caller,f.documentId);
  expect(await f.unread()).toHaveLength(0);
  expect((await f.service.listUnreadForOwner(f.caller)).notifications).toHaveLength(0);
  await expect(f.service.markDocumentRead(f.viewer,f.documentId)).rejects.toMatchObject({code:"SHARE_LINK_NOT_FOUND"});
  expect(t.id).toBeTruthy();
 });
 it("groups unread link comments by document and selects the latest thread", async () => {
  const f = await fixture();
  const first = await f.service.createForLink(f.viewer, { token: f.token, expectedRevisionId: f.revisionId, anchor: f.anchor, body: "First", idempotencyKey: randomUUID() });
  const reply = await f.service.replyForLink(f.viewer, { token: f.token, threadId: first.id, body: "Second", idempotencyKey: randomUUID() });
  expect(reply.id).toBeTruthy();
  expect(await f.service.listUnreadShareCountsForOwner(f.caller)).toEqual([
    { documentId: f.documentId, shareLinkId: null, unreadCount: 2, latestThreadId: first.id },
  ]);
  expect(await f.service.listUnreadShareCountsForOwner(f.viewer)).toEqual([]);
  await f.service.markDocumentRead(f.caller, f.documentId);
  expect(await f.service.listUnreadShareCountsForOwner(f.caller)).toEqual([]);
 });
 it("excludes hidden and retracted comments from My shares unread counts", async () => {
  const f = await fixture();
  const first = await f.service.createForLink(f.viewer, { token: f.token, expectedRevisionId: f.revisionId, anchor: f.anchor, body: "Hidden", idempotencyKey: randomUUID() });
  await f.service.setVisibility(f.caller, { documentId: f.documentId, threadId: first.id, visibility: "HIDDEN", reason: "moderated" });
  expect(await f.service.listUnreadShareCountsForOwner(f.caller)).toEqual([]);
 });

 it("activity retains read history and exposes open/resolved state without leaking to a reviewer", async () => {
  const f = await fixture();
  const t = await f.service.createForLink(f.viewer, { token: f.token, expectedRevisionId: f.revisionId, anchor: f.anchor, body: "Decision needed", idempotencyKey: randomUUID() });
  const first = await f.service.listActivityForOwner(f.caller);
  expect(first.notifications).toHaveLength(1);
  expect(first.notifications[0]).toMatchObject({ readAt: null, threadStatus: "OPEN" });
  expect((await f.service.listActivityForOwner(f.viewer)).notifications).toHaveLength(0);
  await f.service.markEventRead(f.viewer, first.notifications[0].id);
  expect((await f.service.listUnreadForOwner(f.caller)).notifications).toHaveLength(1);
  await f.service.markEventRead(f.caller, first.notifications[0].id);
  expect((await f.service.listUnreadForOwner(f.caller)).notifications).toHaveLength(0);
  expect((await f.service.listActivityForOwner(f.caller)).notifications[0].readAt).not.toBeNull();
  await f.service.setResolution(f.caller, { documentId: f.documentId, threadId: t.id, status: "RESOLVED" });
  expect((await f.service.listActivityForOwner(f.caller)).notifications[0].threadStatus).toBe("RESOLVED");
 });
 it("mark all read affects only this owner", async () => {
  const f = await fixture();
  await f.service.createForLink(f.viewer, { token: f.token, expectedRevisionId: f.revisionId, anchor: f.anchor, body: "One", idempotencyKey: randomUUID() });
  await f.service.markAllActivityRead(f.viewer);
  expect((await f.service.listUnreadForOwner(f.caller)).notifications).toHaveLength(1);
  await f.service.markAllActivityRead(f.caller);
  expect((await f.service.listUnreadForOwner(f.caller)).notifications).toHaveLength(0);
  expect((await f.service.listActivityForOwner(f.caller)).notifications).toHaveLength(1);
 });
 it("revoked-link writes fail and insert no event",async()=>{
  const f=await fixture();
  await f.shares.revoke(f.caller,f.a.id);
  await expect(f.service.createForLink(f.viewer,{token:f.token,expectedRevisionId:f.revisionId,anchor:f.anchor,body:"PRIVATE COMMENT",idempotencyKey:randomUUID()})).rejects.toMatchObject({code:"SHARE_LINK_NOT_FOUND"});
  expect(await f.unread()).toHaveLength(0);
 });
});
describe("the owner is not news to themselves, and the badge counts what the Inbox lists",()=>{
 it("the owner writing through their own link inserts nothing",async()=>{
  const f=await fixture();
  const t=await f.service.createForLink(f.caller,{token:f.token,expectedRevisionId:f.revisionId,anchor:f.anchor,body:"mine",idempotencyKey:randomUUID()});
  await f.service.replyForLink(f.caller,{token:f.token,threadId:t.id,body:"mine again",idempotencyKey:randomUUID()});
  expect(await f.unread()).toHaveLength(0);
  expect(await f.service.listUnreadShareCountsForOwner(f.caller)).toEqual([]);
  expect(await f.service.countUnreadForOwner(f.caller)).toEqual({count:0});
  await f.service.replyForLink(f.viewer,{token:f.token,threadId:t.id,body:"theirs",idempotencyKey:randomUUID()});
  expect(await f.unread()).toHaveLength(1);
 });
 it("countUnreadForOwner follows listUnreadForOwner through writes, reads and hiding",async()=>{
  const f=await fixture();
  const same=async(count:number)=>{expect((await f.service.listUnreadForOwner(f.caller)).notifications).toHaveLength(count);expect(await f.service.countUnreadForOwner(f.caller)).toEqual({count});};
  await same(0);
  const t=await f.service.createForLink(f.viewer,{token:f.token,expectedRevisionId:f.revisionId,anchor:f.anchor,body:"one",idempotencyKey:randomUUID()});
  const reply=await f.service.replyForLink(f.viewer,{token:f.token,threadId:t.id,body:"two",idempotencyKey:randomUUID()});
  await same(2);
  await f.service.deleteForLink(f.viewer,{token:f.token,threadId:t.id,commentId:reply.id});
  await same(1);
  await f.service.setVisibility(f.caller,{documentId:f.documentId,threadId:t.id,visibility:"HIDDEN",reason:"spam"});
  await same(0);
  await f.service.setVisibility(f.caller,{documentId:f.documentId,threadId:t.id,visibility:"VISIBLE"});
  await same(1);
  await f.service.markAllActivityRead(f.caller);
  await same(0);
 });
 it("a token in upper case reaches the discussion, as it reaches the page",async()=>{
  const f=await fixture();
  const upper=f.token.toUpperCase();
  expect(upper).not.toBe(f.token);
  const t=await f.service.createForLink(f.viewer,{token:upper,expectedRevisionId:f.revisionId,anchor:f.anchor,body:"loud",idempotencyKey:randomUUID()});
  expect((await f.service.queryForLink(null,upper)).threads.map(x=>x.id)).toEqual([t.id]);
  await expect(f.shares.readShared(upper)).resolves.toMatchObject({title:"Review"});
 });
});

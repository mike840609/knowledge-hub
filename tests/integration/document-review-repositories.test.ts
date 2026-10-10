import {afterAll,beforeAll,expect,it} from "vitest";
import type {Pool} from "mariadb";
import {randomUUID} from "node:crypto";
import {databaseConfig} from "@/infrastructure/database/mariadb/config";
import {createDatabasePool} from "@/infrastructure/database/mariadb/pool";
import {MariaDbUnitOfWork} from "@/infrastructure/database/mariadb/transaction";
import {callerFromIdentity} from "@/modules/identity/domain/caller-context";
import {HubKnowledgeCommandServiceImpl} from "@/modules/knowledge/application/hub-knowledge-command-service";
import {ensureDefaultHubSource} from "@/modules/sources/application/ensure-default-hub-source";
import {PersonalWorkspaceService} from "@/modules/workspaces/application/personal-workspace-service";
import type {ReviewThread,ReviewComment} from "@/modules/knowledge/domain/document-review";
import {uuidv7} from "@/shared/ids/uuidv7";
import {cleanupDocumentReviewWriteEvents} from "../../scripts/admin/cleanup-document-review-write-events";
let pool:Pool;
beforeAll(()=>{pool=createDatabasePool(databaseConfig("test"));});afterAll(async()=>pool.end());
async function fixture(){
 const id=uuidv7(),uow=new MariaDbUnitOfWork(pool),caller=callerFromIdentity({id,emp_id:`REVIEW-REPO-${id}`,name:"Reviewer",org_code:"TEST"});
 await uow.run(r=>r.users.upsertIdentity(caller.identity));
 const {workspace}=await new PersonalWorkspaceService(uow).ensurePersonalWorkspace(id),sourceId=await ensureDefaultHubSource(uow,caller,workspace.id);
 const {documentId}=await new HubKnowledgeCommandServiceImpl(uow).createDocument(caller,{sourceId,parentId:null,title:"Review",markdown:"Hello",metadata:{}});
 const document=await uow.run(r=>r.documents.findById(documentId));
 const now=new Date(),hidden={visibility:"VISIBLE" as const,hiddenBy:null,hiddenAt:null,hiddenReason:null};
 const thread:ReviewThread={id:uuidv7(),documentId,createdRevisionId:document!.currentRevisionId!,createdBy:id,creationIdempotencyKey:randomUUID(),creationRequestHash:"a".repeat(64),originShareLinkId:null,anchor:{schemaVersion:1,blockPath:[0],blockKind:"paragraph",startUtf16:0,endUtf16:5,exact:"Hello",prefix:"",suffix:""},status:"OPEN",resolvedBy:null,resolvedAt:null,createdAt:now,updatedAt:now,...hidden};
 const comment:ReviewComment={id:uuidv7(),threadId:thread.id,authorUserId:id,body:"Review body",createdAt:now,idempotencyKey:randomUUID(),requestHash:"b".repeat(64),...hidden};
 await uow.run(async r=>{await r.reviewThreads.insert(thread);await r.reviewComments.insert(comment);});
 return{uow,id,thread,comment,now};
}
it("round trips anchors, unique keys, visibility counts and opener invariant",async()=>{
 const f=await fixture();
 await f.uow.run(async r=>{
 expect(await r.reviewThreads.findByCreationKey(f.thread.documentId,f.id,f.thread.creationIdempotencyKey)).toEqual(f.thread);
 expect(await r.reviewComments.findByIdempotencyKey(f.thread.id,f.id,f.comment.idempotencyKey)).toEqual(f.comment);
 expect(await r.reviewThreads.countVisibleByDocument(f.thread.documentId)).toBe(1);
 expect(await r.reviewThreads.countVisibleOpenByCreator(f.thread.documentId,f.id)).toBe(1);
 expect(await r.reviewComments.countByThread(f.thread.id)).toBe(1);
 await expect(r.reviewComments.setVisibility(f.comment.id,"HIDDEN",f.id,f.now,"secret")).rejects.toBeDefined();
 await r.reviewThreads.setVisibility(f.thread.id,"HIDDEN",f.id,f.now,"secret");
 expect(await r.reviewThreads.countVisibleByDocument(f.thread.documentId)).toBe(0);
 await r.reviewThreads.setVisibility(f.thread.id,"VISIBLE",f.id,f.now,null);
 await r.reviewThreads.setResolution(f.thread.id,"RESOLVED",f.id,f.now);
 expect(await r.reviewThreads.countVisibleOpenByCreator(f.thread.documentId,f.id)).toBe(0);
 });
 await expect(f.uow.run(r=>r.reviewThreads.insert({...f.thread,id:uuidv7()}))).rejects.toBeDefined();
 await expect(f.uow.run(r=>r.reviewComments.insert({...f.comment,id:uuidv7()}))).rejects.toBeDefined();
});
it("counts rolling hour from persistent storage and cleanup preserves current window",async()=>{
 const f=await fixture(),old=new Date(f.now.getTime()-49*3600_000);
 await f.uow.run(async r=>{for(const createdAt of [old,f.now])await r.reviewWriteLedger.record({id:uuidv7(),userId:f.id,documentId:f.thread.documentId,createdAt});expect(await r.reviewWriteLedger.countSince(f.id,f.thread.documentId,new Date(f.now.getTime()-3600_000))).toBe(1);});
 expect(await cleanupDocumentReviewWriteEvents(pool,{now:f.now})).toBeGreaterThanOrEqual(1);
 expect(await f.uow.run(r=>r.reviewWriteLedger.countSince(f.id,f.thread.documentId,new Date(0)))).toBe(2);
 await cleanupDocumentReviewWriteEvents(pool,{now:f.now,apply:true,batchSize:1});
 expect(await f.uow.run(r=>r.reviewWriteLedger.countSince(f.id,f.thread.documentId,new Date(0)))).toBe(1);
});

import { afterAll, beforeAll, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import { PersonalWorkspaceService } from "@/modules/workspaces/application/personal-workspace-service";
import { ensureDefaultHubSource } from "@/modules/sources/application/ensure-default-hub-source";
import { HubKnowledgeCommandServiceImpl } from "@/modules/knowledge/application/hub-knowledge-command-service";
import type { KnowledgeCollection, KnowledgeCollectionItem } from "@/modules/knowledge/domain/knowledge-collection";
import { uuidv7 } from "@/shared/ids/uuidv7";

let pool: Pool;
beforeAll(() => { pool = createDatabasePool(databaseConfig("test")); });
afterAll(async () => pool?.end());

async function fixture() {
  const userId = uuidv7(), uow = new MariaDbUnitOfWork(pool);
  const caller = callerFromIdentity({id:userId,emp_id:`COLL-${userId}`,name:"Collection Owner",org_code:"COLL"});
  await uow.run(r => r.users.upsertIdentity(caller.identity));
  const {workspace} = await new PersonalWorkspaceService(uow).ensurePersonalWorkspace(userId);
  const sourceId = await ensureDefaultHubSource(uow,caller,workspace.id);
  const create = new HubKnowledgeCommandServiceImpl(uow);
  const first = await create.createDocument(caller,{sourceId,parentId:null,title:"Architecture",markdown:"# System",metadata:{}});
  const second = await create.createDocument(caller,{sourceId,parentId:null,title:"Operations",markdown:"# Runbook",metadata:{}});
  const now = new Date("2026-10-15T00:00:00.000Z");
  const collection: KnowledgeCollection = {
    id:uuidv7(),workspaceId:workspace.id,name:"Onboarding",description:"Start here",
    version:1,status:"ACTIVE",createdBy:userId,updatedBy:userId,archivedBy:null,archivedAt:null,createdAt:now,updatedAt:now,
  };
  const item = (documentId:string,position:number):KnowledgeCollectionItem => ({
    id:uuidv7(),collectionId:collection.id,documentId,position,readingNote:"Read first",addedAt:now,
  });
  await uow.run(r => r.collections.insert(collection));
  return {caller,uow,workspace,sourceId,first,second,collection,item,now};
}

it("persists an empty collection and ordered document references without copying content", async () => {
  const f=await fixture();
  const a=f.item(f.first.documentId,0),b=f.item(f.second.documentId,1);
  await f.uow.run(async r=>{
    await r.collections.insertItem(a);
    await r.collections.insertItem(b);
  });
  const result=await f.uow.run(async r=>({
    collection:await r.collections.findById(f.collection.id),
    rows:await r.collections.listItems(f.collection.id),
    view:await r.collections.resolveItems(f.collection.id,f.workspace.id),
  }));
  expect(result.collection?.name).toBe("Onboarding");
  expect(result.rows.map(r=>r.documentId)).toEqual([a.documentId,b.documentId]);
  expect(result.view.map(r=>r.title)).toEqual(["Architecture","Operations"]);
  expect(result.view[0]).toMatchObject({state:"available",readingNote:"Read first",sourceId:f.sourceId});
  expect(JSON.stringify(result)).not.toContain("# System");
});

it("hides archived document metadata while preserving membership and its order", async () => {
  const f=await fixture(), a=f.item(f.first.documentId,0);
  await f.uow.run(async r=>{
    await r.collections.insertItem(a);
    await r.documents.updateStatus(f.first.documentId,"ARCHIVED",f.caller.identity.id);
  });
  const result=await f.uow.run(r=>r.collections.resolveItems(f.collection.id,f.workspace.id));
  expect(result).toEqual([{id:a.id,position:0,state:"unavailable"}]);
  const stillThere=await f.uow.run(r=>r.collections.listItems(f.collection.id));
  expect(stillThere).toHaveLength(1);
  expect(stillThere[0].readingNote).toBe("Read first");
});

it("enforces one referenced document per collection, retains items through archive", async () => {
  const f=await fixture(),a=f.item(f.first.documentId,0);
  await f.uow.run(r=>r.collections.insertItem(a));
  await expect(f.uow.run(r=>r.collections.insertItem(f.item(f.first.documentId,1)))).rejects.toBeDefined();
  const archived={...f.collection,version:2,status:"ARCHIVED" as const,archivedBy:f.caller.identity.id,archivedAt:new Date(),updatedAt:new Date()};
  await f.uow.run(r=>r.collections.saveMetadata(archived));
  expect((await f.uow.run(r=>r.collections.listItems(f.collection.id))).map(x=>x.id)).toEqual([a.id]);
  const listed=await f.uow.run(r=>r.collections.listByWorkspace(f.workspace.id,"ARCHIVED",null,51));
  expect(listed.some(x=>x.id===f.collection.id && x.totalItems===1)).toBe(true);
});

it("allows stable ordering updates and rejects unknown collection references by FK", async () => {
  const f=await fixture(),a=f.item(f.first.documentId,0),b=f.item(f.second.documentId,1);
  await f.uow.run(async r=>{await r.collections.insertItem(a);await r.collections.insertItem(b);});
  await f.uow.run(r=>r.collections.replacePositions(f.collection.id,[{id:a.id,position:1},{id:b.id,position:0}]));
  expect((await f.uow.run(r=>r.collections.listItems(f.collection.id))).map(x=>x.id)).toEqual([b.id,a.id]);
  await expect(f.uow.run(r=>r.collections.insertItem({...a,id:uuidv7(),collectionId:uuidv7(),documentId:uuidv7()}))).rejects.toBeDefined();
});

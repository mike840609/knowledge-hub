import { afterAll, beforeAll, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { KnowledgeCollectionService } from "@/modules/knowledge/application/knowledge-collection-service";
import { collectionFixture } from "../fixtures/knowledge-collections";

let pool:Pool;
beforeAll(()=>{pool=createDatabasePool(databaseConfig("test"));});
afterAll(async()=>pool.end());

it("lists and reads a collection under the owning workspace with current title",async()=>{
  const f=await collectionFixture(pool),svc=new KnowledgeCollectionService(f.uow);
  const {id}=await svc.create(f.caller,f.workspace.id,{name:"Start here",description:"Read in order"});
  const {version}=await svc.addItem(f.caller,f.workspace.id,id,{documentId:f.d1.documentId,readingNote:"Start with this",expectedVersion:1});
  expect(version).toBe(2);
  const list=await svc.list(f.caller,f.workspace.id,{});
  expect(list.items.some(i=>i.id===id&&i.availableItems===1)).toBe(true);
  const detail=await svc.get(f.caller,f.workspace.id,id);
  expect(detail.collection.name).toBe("Start here");
  expect(detail.items).toMatchObject([{state:"available",title:"Overview",readingNote:"Start with this"}]);
  expect(JSON.stringify(detail)).not.toContain("First content");
});

it("hides archived target metadata and restores it without remapping identifiers",async()=>{
  const f=await collectionFixture(pool),svc=new KnowledgeCollectionService(f.uow);
  const {id}=await svc.create(f.caller,f.workspace.id,{name:"Handoff"});
  await svc.addItem(f.caller,f.workspace.id,id,{documentId:f.d1.documentId,expectedVersion:1});
  await f.uow.run(r=>r.documents.updateStatus(f.d1.documentId,"ARCHIVED",f.caller.identity.id));
  const archived=await svc.get(f.caller,f.workspace.id,id);
  expect(archived.items).toMatchObject([{state:"unavailable"}]);
  expect(archived.items[0]).not.toHaveProperty("title");
  expect(archived.items[0]).not.toHaveProperty("documentId");
  expect(archived.items[0]).not.toHaveProperty("readingNote");
  await f.uow.run(r=>r.documents.updateStatus(f.d1.documentId,"ACTIVE",f.caller.identity.id));
  expect((await svc.get(f.caller,f.workspace.id,id)).items[0].documentId).toBe(f.d1.documentId);
});

it("rejects cross-workspace access and reference insertion",async()=>{
  const a=await collectionFixture(pool),b=await collectionFixture(pool);
  const svc=new KnowledgeCollectionService(a.uow);
  const {id}=await svc.create(a.caller,a.workspace.id,{name:"Security"});
  await expect(svc.get(b.caller,a.workspace.id,id)).rejects.toBeDefined();
  await expect(svc.list(b.caller,a.workspace.id,{})).rejects.toBeDefined();
  await expect(svc.addItem(a.caller,a.workspace.id,id,{documentId:b.d1.documentId,expectedVersion:1})).rejects.toBeDefined();
  expect((await svc.get(a.caller,a.workspace.id,id)).items).toEqual([]);
});

it("supports concurrent-safe metadata, items, notes, ordering, and archive/restore",async()=>{
  const f=await collectionFixture(pool),svc=new KnowledgeCollectionService(f.uow);
  const {id,version:v1}=await svc.create(f.caller,f.workspace.id,{name:"Engineering"});
  expect(v1).toBe(1);
  const {version:v2}=await svc.update(f.caller,f.workspace.id,id,{name:"System",expectedVersion:v1});
  expect(v2).toBe(2);
  await expect(svc.update(f.caller,f.workspace.id,id,{name:"Stale",expectedVersion:v1})).rejects.toMatchObject({code:"COLLECTION_CONFLICT"});
  const v3=(await svc.addItem(f.caller,f.workspace.id,id,{documentId:f.d1.documentId,expectedVersion:v2})).version;
  const v4=(await svc.addItem(f.caller,f.workspace.id,id,{documentId:f.d2.documentId,expectedVersion:v3})).version;
  await expect(svc.addItem(f.caller,f.workspace.id,id,{documentId:f.d1.documentId,expectedVersion:v4})).rejects.toMatchObject({code:"COLLECTION_DUPLICATE_ITEM"});
  const before=await svc.get(f.caller,f.workspace.id,id);
  const ids=before.items.map(i=>i.id);
  const v5=(await svc.reorder(f.caller,f.workspace.id,id,{itemIds:[ids[1],ids[0]],expectedVersion:v4})).version;
  expect((await svc.get(f.caller,f.workspace.id,id)).items.map(i=>i.id)).toEqual([ids[1],ids[0]]);
  await expect(svc.reorder(f.caller,f.workspace.id,id,{itemIds:[ids[0],ids[0]],expectedVersion:v5})).rejects.toMatchObject({code:"COLLECTION_INVALID"});
  const v6=(await svc.editItemNote(f.caller,f.workspace.id,id,ids[0],{readingNote:"Read why",expectedVersion:v5})).version;
  const v7=(await svc.removeItem(f.caller,f.workspace.id,id,ids[1],v6)).version;
  expect((await svc.get(f.caller,f.workspace.id,id)).items.map(i=>i.position)).toEqual([0]);
  const v8=(await svc.update(f.caller,f.workspace.id,id,{status:"ARCHIVED",expectedVersion:v7})).version;
  expect((await svc.get(f.caller,f.workspace.id,id)).collection.status).toBe("ARCHIVED");
  await expect(svc.addItem(f.caller,f.workspace.id,id,{documentId:f.d1.documentId,expectedVersion:v8})).rejects.toBeDefined();
  const v9=(await svc.update(f.caller,f.workspace.id,id,{status:"ACTIVE",expectedVersion:v8})).version;
  expect(v9).toBe(v8+1);
  expect((await svc.get(f.caller,f.workspace.id,id)).collection.status).toBe("ACTIVE");
});

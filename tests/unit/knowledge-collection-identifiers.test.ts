import {expect,it,vi} from "vitest";
import {KnowledgeCollectionService} from "@/modules/knowledge/application/knowledge-collection-service";
import type {KnowledgeUnitOfWork} from "@/modules/knowledge/ports/unit-of-work";
import {callerFromIdentity} from "@/modules/identity/domain/caller-context";

const workspaceId="0199b29e-ef74-74ec-8abe-dcdf8651b810";
const collectionId="0199b29e-ef74-74ec-8abe-dcdf8651b811";
const caller=callerFromIdentity({id:"0199b29e-ef74-74ec-8abe-dcdf8651b812",emp_id:"COLLECTION",name:"Reader",org_code:"ORG"});

it("rejects malformed collection and item identifiers without accessing the database",async()=>{
 const run=vi.fn(async()=>{throw new Error("database must not run");});
 const service=new KnowledgeCollectionService({run} as unknown as KnowledgeUnitOfWork);
 await expect(service.get(caller,workspaceId,"../../unknown")).rejects.toMatchObject({code:"COLLECTION_NOT_FOUND"});
 await expect(service.update(caller,workspaceId,"../../unknown",{name:"Unsafe",expectedVersion:1})).rejects.toMatchObject({code:"COLLECTION_NOT_FOUND"});
 await expect(service.addItem(caller,workspaceId,"../../unknown",{documentId:collectionId,expectedVersion:1})).rejects.toMatchObject({code:"COLLECTION_NOT_FOUND"});
 await expect(service.editItemNote(caller,workspaceId,collectionId,"../../unknown",{readingNote:"",expectedVersion:1})).rejects.toMatchObject({code:"COLLECTION_NOT_FOUND"});
 await expect(service.removeItem(caller,workspaceId,collectionId,"../../unknown",1)).rejects.toMatchObject({code:"COLLECTION_NOT_FOUND"});
 await expect(service.reorder(caller,workspaceId,"../../unknown",{itemIds:[],expectedVersion:1})).rejects.toMatchObject({code:"COLLECTION_NOT_FOUND"});
 expect(run).not.toHaveBeenCalled();
});

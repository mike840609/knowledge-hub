import type { CallerContext } from "@/modules/identity/domain/caller-context";
import { syncCallerIdentity } from "@/modules/identity/application/sync-caller-identity";
import type { KnowledgeUnitOfWork } from "../ports/unit-of-work";
import { COLLECTION_PAGE_SIZE, encodeCollectionCursor, parseCollectionCursor,
  type CollectionDetail, type CollectionPage } from "../domain/knowledge-collection";
import { KnowledgeCollectionError } from "../domain/knowledge-collection-errors";
import {isUuid} from "@/shared/ids/uuidv7";
function requireResourceId(value:string):void {
  if(!isUuid(value))throw new KnowledgeCollectionError("COLLECTION_NOT_FOUND","Collection resource unavailable.");
}
import { createCollection,updateCollection } from "./internal/collection-lifecycle";
import { addCollectionItem,editCollectionItemNote } from "./internal/collection-item-create";
import { removeCollectionItem,reorderCollectionItems } from "./internal/collection-item-order";

export class KnowledgeCollectionService {
  constructor(private readonly unitOfWork:KnowledgeUnitOfWork,private readonly clock:()=>Date=()=>new Date()){}

  async list(
    caller:CallerContext,workspaceId:string,
    input:{status?:"ACTIVE"|"ARCHIVED";cursor?:string|null}={},
  ):Promise<CollectionPage>{
    const status=input.status??"ACTIVE";
    if(status!=="ACTIVE"&&status!=="ARCHIVED")
      throw new KnowledgeCollectionError("COLLECTION_INVALID","Invalid collection status.");
    const cursor=parseCollectionCursor(input.cursor);
    return this.unitOfWork.run(async r=>{
      await syncCallerIdentity(r.users,caller);
      await r.workspaceAccess.requireWorkspaceRead(caller,workspaceId);
      const workspace=await r.workspaces.findById(workspaceId);
      if(!workspace)throw new KnowledgeCollectionError("COLLECTION_NOT_FOUND","Workspace unavailable.");
      const rows=await r.collections.listByWorkspace(workspaceId,status,cursor,COLLECTION_PAGE_SIZE+1);
      const page=rows.slice(0,COLLECTION_PAGE_SIZE);
      const last=page[page.length-1];
      return {items:page,nextCursor:rows.length>COLLECTION_PAGE_SIZE&&last
        ?encodeCollectionCursor(last.updatedAt,last.id):null};
    });
  }

  async get(caller:CallerContext,workspaceId:string,collectionId:string):Promise<CollectionDetail>{
    requireResourceId(collectionId);
    return this.unitOfWork.run(async r=>{
      await syncCallerIdentity(r.users,caller);
      await r.workspaceAccess.requireWorkspaceRead(caller,workspaceId);
      const collection=await r.collections.findById(collectionId);
      if(!collection||collection.workspaceId!==workspaceId)
        throw new KnowledgeCollectionError("COLLECTION_NOT_FOUND","Collection unavailable.");
      const items=await r.collections.resolveItems(collection.id,workspaceId);
      return {collection,items};
    });
  }

  create(caller:CallerContext,workspaceId:string,input:{name:unknown;description?:unknown}):Promise<{id:string;version:number}> {
    return this.unitOfWork.run(r=>createCollection(r,caller,workspaceId,input,this.clock()));
  }
  async update(caller:CallerContext,workspaceId:string,collectionId:string,
    input:{expectedVersion:unknown;name?:unknown;description?:unknown;status?:"ACTIVE"|"ARCHIVED"}):Promise<{version:number}>{
    requireResourceId(collectionId);
    return this.unitOfWork.run(r=>updateCollection(r,caller,workspaceId,collectionId,input,this.clock()));
  }
  async addItem(caller:CallerContext,workspaceId:string,collectionId:string,
    input:{documentId:unknown;readingNote?:unknown;expectedVersion:unknown}):Promise<{version:number}>{
    requireResourceId(collectionId);
    return this.unitOfWork.run(r=>addCollectionItem(r,caller,workspaceId,collectionId,input,this.clock()));
  }
  async editItemNote(caller:CallerContext,workspaceId:string,collectionId:string,itemId:string,
    input:{readingNote:unknown;expectedVersion:unknown}):Promise<{version:number}>{
    requireResourceId(collectionId);requireResourceId(itemId);
    return this.unitOfWork.run(r=>editCollectionItemNote(r,caller,workspaceId,collectionId,itemId,input,this.clock()));
  }
  async removeItem(caller:CallerContext,workspaceId:string,collectionId:string,itemId:string,expectedVersion:unknown):Promise<{version:number}>{
    requireResourceId(collectionId);requireResourceId(itemId);
    return this.unitOfWork.run(r=>removeCollectionItem(r,caller,workspaceId,collectionId,itemId,expectedVersion,this.clock()));
  }
  async reorder(caller:CallerContext,workspaceId:string,collectionId:string,
    input:{itemIds:unknown;expectedVersion:unknown}):Promise<{version:number}>{
    requireResourceId(collectionId);
    return this.unitOfWork.run(r=>reorderCollectionItems(r,caller,workspaceId,collectionId,input,this.clock()));
  }
}

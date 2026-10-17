import type { CallerContext } from "@/modules/identity/domain/caller-context";
import type { KnowledgeRepositories } from "../../ports/unit-of-work";
import { validateCollectionOrder } from "../../domain/knowledge-collection";
import { KnowledgeCollectionError } from "../../domain/knowledge-collection-errors";
import { mutateCollection } from "./collection-write";

export async function removeCollectionItem(
  r:KnowledgeRepositories,caller:CallerContext,workspaceId:string,collectionId:string,
  itemId:string,expectedVersion:unknown,now:Date,
):Promise<{version:number}>{
  return mutateCollection(r,caller,workspaceId,collectionId,expectedVersion,now,async ()=>{
    const items=await r.collections.listItems(collectionId);
    if(!items.some(i=>i.id===itemId))
      throw new KnowledgeCollectionError("COLLECTION_NOT_FOUND","Collection item unavailable.");
    await r.collections.deleteItem(itemId);
    await r.collections.replacePositions(collectionId,items.filter(i=>i.id!==itemId)
      .map((i,position)=>({id:i.id,position})));
  });
}

export async function reorderCollectionItems(
  r:KnowledgeRepositories,caller:CallerContext,workspaceId:string,collectionId:string,
  input:{itemIds:unknown;expectedVersion:unknown},now:Date,
):Promise<{version:number}>{
  return mutateCollection(r,caller,workspaceId,collectionId,input.expectedVersion,now,async ()=>{
    const existing=await r.collections.listItems(collectionId);
    if(!Array.isArray(input.itemIds))
      throw new KnowledgeCollectionError("COLLECTION_INVALID","Item order must be an array.");
    validateCollectionOrder(existing.map(i=>i.id),input.itemIds);
    await r.collections.replacePositions(collectionId,
      (input.itemIds as string[]).map((id,position)=>({id,position})));
  });
}

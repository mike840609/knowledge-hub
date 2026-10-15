import type { CallerContext } from "@/modules/identity/domain/caller-context";
import { uuidv7, isUuid } from "@/shared/ids/uuidv7";
import type { KnowledgeRepositories } from "../../ports/unit-of-work";
import { MAX_COLLECTION_ITEMS, normalizeReadingNote } from "../../domain/knowledge-collection";
import { KnowledgeCollectionError } from "../../domain/knowledge-collection-errors";
import { mutateCollection } from "./collection-write";

export async function addCollectionItem(
  r:KnowledgeRepositories,caller:CallerContext,workspaceId:string,collectionId:string,
  input:{documentId:unknown;readingNote?:unknown;expectedVersion:unknown},now:Date,
):Promise<{version:number}>{
  if(typeof input.documentId!=="string"||!isUuid(input.documentId))
    throw new KnowledgeCollectionError("COLLECTION_INVALID","Invalid document reference.");
  const note=normalizeReadingNote(input.readingNote),documentId=input.documentId;
  return mutateCollection(r,caller,workspaceId,collectionId,input.expectedVersion,now,async ()=>{
    const items=await r.collections.listItems(collectionId);
    if(items.some(i=>i.documentId===documentId))
      throw new KnowledgeCollectionError("COLLECTION_DUPLICATE_ITEM","This document is already included.");
    if(items.length>=MAX_COLLECTION_ITEMS)
      throw new KnowledgeCollectionError("COLLECTION_LIMIT","A collection may contain at most 200 documents.");
    const doc=await r.documents.findById(documentId);
    if(!doc)throw new KnowledgeCollectionError("COLLECTION_NOT_FOUND","Document unavailable.");
    const source=await r.sourcePolicy.lockById(doc.sourceId);
    if(!source||source.workspaceId!==workspaceId||source.status!=="ACTIVE")
      throw new KnowledgeCollectionError("COLLECTION_NOT_FOUND","Document unavailable.");
    const current=await r.documents.lockById(documentId);
    if(!current||current.sourceId!==source.id||current.status!=="ACTIVE"||!current.currentRevisionId)
      throw new KnowledgeCollectionError("COLLECTION_NOT_FOUND","Document unavailable.");
    await r.documents.assertComplete(documentId);
    await r.collections.insertItem({
      id:uuidv7(),collectionId,documentId,position:items.length,readingNote:note,addedAt:now,
    });
  });
}

export async function editCollectionItemNote(
  r:KnowledgeRepositories,caller:CallerContext,workspaceId:string,collectionId:string,itemId:string,
  input:{readingNote:unknown;expectedVersion:unknown},now:Date,
):Promise<{version:number}>{
  const note=normalizeReadingNote(input.readingNote);
  return mutateCollection(r,caller,workspaceId,collectionId,input.expectedVersion,now,async ()=>{
    const items=await r.collections.listItems(collectionId);
    if(!items.some(i=>i.id===itemId))
      throw new KnowledgeCollectionError("COLLECTION_NOT_FOUND","Collection item unavailable.");
    await r.collections.updateItemNote(itemId,note);
  });
}

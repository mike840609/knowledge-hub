import type { CallerContext } from "@/modules/identity/domain/caller-context";
import { uuidv7 } from "@/shared/ids/uuidv7";
import type { KnowledgeRepositories } from "../../ports/unit-of-work";
import { normalizeCollectionName, normalizeCollectionDescription, type KnowledgeCollection } from "../../domain/knowledge-collection";
import { KnowledgeCollectionError } from "../../domain/knowledge-collection-errors";
import { requireCollectionWritable, mutateCollection } from "./collection-write";

export async function createCollection(
  r: KnowledgeRepositories, caller: CallerContext, workspaceId: string,
  input: {name:unknown;description?:unknown}, now:Date,
): Promise<{id:string;version:number}> {
  const name=normalizeCollectionName(input.name);
  const description=normalizeCollectionDescription(input.description);
  await requireCollectionWritable(r,caller,workspaceId);
  const value:KnowledgeCollection = {
    id:uuidv7(),workspaceId,name,description,version:1,status:"ACTIVE",
    createdBy:caller.identity.id,updatedBy:caller.identity.id,
    archivedBy:null,archivedAt:null,createdAt:now,updatedAt:now,
  };
  await r.collections.insert(value);
  return {id:value.id,version:1};
}

export async function updateCollection(
  r:KnowledgeRepositories,caller:CallerContext,workspaceId:string,collectionId:string,
  input:{expectedVersion:unknown;name?:unknown;description?:unknown;status?:"ACTIVE"|"ARCHIVED"},
  now:Date,
):Promise<{version:number}> {
  if(input.name===undefined && input.description===undefined && input.status===undefined)
    throw new KnowledgeCollectionError("COLLECTION_INVALID","No collection changes supplied.");
  const name=input.name===undefined?undefined:normalizeCollectionName(input.name);
  const description=input.description===undefined?undefined:normalizeCollectionDescription(input.description);
  if(input.status!==undefined&&input.status!=="ACTIVE"&&input.status!=="ARCHIVED")
    throw new KnowledgeCollectionError("COLLECTION_INVALID","Invalid collection status.");
  return mutateCollection(r,caller,workspaceId,collectionId,input.expectedVersion,now,async existing=>{
    if(existing.status==="ARCHIVED"&&(input.status!=="ACTIVE"||name!==undefined||description!==undefined))
      throw new KnowledgeCollectionError("COLLECTION_CONFLICT","Restore the collection before editing.");
    if(existing.status==="ACTIVE"&&input.status==="ACTIVE")
      throw new KnowledgeCollectionError("COLLECTION_INVALID","Collection is already active.");
    if(existing.status==="ARCHIVED"&&input.status==="ARCHIVED")
      throw new KnowledgeCollectionError("COLLECTION_INVALID","Collection is already archived.");
    const status=input.status??existing.status;
    return {
      name:name??existing.name,description:description??existing.description,status,
      archivedBy:status==="ARCHIVED"?caller.identity.id:null,
      archivedAt:status==="ARCHIVED"?now:null,
    };
  },input.status==="ACTIVE");
}

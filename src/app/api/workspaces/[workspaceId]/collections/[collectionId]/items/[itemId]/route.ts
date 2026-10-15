export const dynamic = "force-dynamic";
import { collectionHttp, collectionBody } from "@/server/collection-http";
import { KnowledgeCollectionError } from "@/modules/knowledge/domain/knowledge-collection-errors";
type Context = { params: Promise<{workspaceId:string;collectionId:string;itemId:string}> };
export async function PATCH(request:Request,context:Context) {
  const {workspaceId,collectionId,itemId}=await context.params;
  return collectionHttp(request,async(service,caller)=>{
    const data=await collectionBody(request);
    return service.editItemNote(caller,workspaceId,collectionId,itemId,{readingNote:data.readingNote,expectedVersion:data.expectedVersion});
  });
}
export async function DELETE(request:Request,context:Context) {
  const {workspaceId,collectionId,itemId}=await context.params;
  return collectionHttp(request,async(service,caller)=>{
    const data=await collectionBody(request);
    if (data.expectedVersion===undefined) throw new KnowledgeCollectionError("COLLECTION_INVALID","Expected version is required.");
    return service.removeItem(caller,workspaceId,collectionId,itemId,data.expectedVersion);
  });
}

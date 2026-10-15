export const dynamic = "force-dynamic";
import { collectionHttp, collectionBody } from "@/server/collection-http";
type Context = { params: Promise<{workspaceId:string;collectionId:string}> };
export async function POST(request:Request,context:Context) {
  const {workspaceId,collectionId}=await context.params;
  return collectionHttp(request,async(service,caller)=>{
    const data=await collectionBody(request);
    return service.addItem(caller,workspaceId,collectionId,{documentId:data.documentId,readingNote:data.readingNote,expectedVersion:data.expectedVersion});
  },201);
}

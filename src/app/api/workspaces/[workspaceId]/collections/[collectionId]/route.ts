export const dynamic = "force-dynamic";
import { collectionHttp, collectionBody } from "@/server/collection-http";
type Context = { params: Promise<{workspaceId:string;collectionId:string}> };
export async function GET(request:Request,context:Context) {
  const {workspaceId,collectionId}=await context.params;
  return collectionHttp(request,(service,caller)=>service.get(caller,workspaceId,collectionId));
}
export async function PATCH(request:Request,context:Context) {
  const {workspaceId,collectionId}=await context.params;
  return collectionHttp(request,async(service,caller)=>{
    const data=await collectionBody(request);
    return service.update(caller,workspaceId,collectionId,{expectedVersion:data.expectedVersion,
      name:data.name,description:data.description,status:data.status as "ACTIVE"|"ARCHIVED"|undefined});
  });
}

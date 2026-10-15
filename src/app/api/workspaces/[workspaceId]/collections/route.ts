export const dynamic = "force-dynamic";
import { collectionHttp, collectionBody } from "@/server/collection-http";
type Context = { params: Promise<{workspaceId:string}> };
export async function GET(request:Request,context:Context) {
  const {workspaceId}=await context.params;
  const params=new URL(request.url).searchParams;
  const status=params.get("status")??"ACTIVE";
  return collectionHttp(request,(service,caller)=>service.list(caller,workspaceId,{
    status:status as "ACTIVE"|"ARCHIVED",cursor:params.get("cursor"),
  }));
}
export async function POST(request:Request,context:Context) {
  const {workspaceId}=await context.params;
  return collectionHttp(request,async(service,caller)=>{
    const data=await collectionBody(request);
    return service.create(caller,workspaceId,{name:data.name,description:data.description});
  },201);
}

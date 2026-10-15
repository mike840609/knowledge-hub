export const dynamic="force-dynamic";
import { NextResponse } from "next/server";
import { applicationServices } from "@/server/composition";
import { toWorkspaceErrorResponse } from "@/server/http-error-response";
export async function GET(request:Request,context:{params:Promise<{workspaceId:string}>}) {
  const headers={"Cache-Control":"private, no-store"};
  try {
    const {workspaceId}=await context.params;
    const q=new URL(request.url).searchParams.get("q")?.trim()??"";
    if(q.length===0)return NextResponse.json({items:[]},{headers});
    if(q.length>200)return NextResponse.json({error:{code:"COLLECTION_INVALID",message:"Search term is too long."}},{status:400,headers});
    const s=applicationServices();
    const {caller}=await s.establishTrustedCaller();
    await s.unitOfWork.run(r=>r.workspaceAccess.requireWorkspaceRead(caller,workspaceId));
    const result=await s.search.search(caller,{q,scope:{kind:"workspace",workspaceId},sourceId:null,includeArchived:false,page:1});
    return NextResponse.json({items:result.hits.slice(0,20).filter(hit=>hit.status==="ACTIVE").map(hit=>({
      documentId:hit.documentId,sourceId:hit.sourceId,title:hit.title,sourceName:hit.sourceName,
    }))},{headers});
  } catch(error) {
    const mapped=toWorkspaceErrorResponse(error);
    return NextResponse.json(mapped.body,{status:mapped.status,headers});
  }
}

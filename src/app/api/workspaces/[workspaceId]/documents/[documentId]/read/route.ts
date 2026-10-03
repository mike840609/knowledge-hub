import {workspaceHttp,requestFields} from "@/server/workspace-http";
export async function POST(request:Request,context:{params:Promise<{workspaceId:string;documentId:string}>}){
 return workspaceHttp(async(s,caller)=>{
  const {workspaceId,documentId}=await context.params;
  const {revisionId}=await requestFields(request,["revisionId"]);
  await s.documentReadProgress.markRead(caller,{workspaceId,documentId,revisionId});
 },204);
}

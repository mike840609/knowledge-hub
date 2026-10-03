import {applicationServices} from "./composition";
export async function getSyncRunDetail(workspaceId:string,sourceId:string,runId:string,afterOrdinal=0){
 const s=applicationServices();const {caller}=await s.establishTrustedCaller();
 try{return await s.syncReading.get(caller,workspaceId,sourceId,runId,afterOrdinal);}catch{return null;}
}

export async function getFolderUpdates(workspaceId:string,input:Parameters<ReturnType<typeof applicationServices>["folderUpdates"]["list"]>[2]){const s=applicationServices();const {caller}=await s.establishTrustedCaller();try{return await s.folderUpdates.list(caller,workspaceId,input);}catch{return null;}}

export async function getDocumentSourcePath(workspaceId:string,documentId:string){const s=applicationServices();const {caller}=await s.establishTrustedCaller();try{const view=await s.queries.getDocument(caller,documentId,{includeArchived:true});if(view.workspaceId!==workspaceId)return null;return await s.unitOfWork.run(async r=>(await r.entries.findByDocumentId(documentId))?.sourcePath??null);}catch{return null;}}

import {applicationServices} from "./composition";
export async function getSyncRunDetail(workspaceId:string,sourceId:string,runId:string,afterOrdinal=0){
 const s=applicationServices();const {caller}=await s.establishTrustedCaller();
 try{return await s.syncReading.get(caller,workspaceId,sourceId,runId,afterOrdinal);}catch{return null;}
}

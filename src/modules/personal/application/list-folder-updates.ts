import type {CallerContext} from "@/modules/identity/domain/caller-context";
import type {SourceUnitOfWork} from "@/modules/sources/ports/unit-of-work";
import type {RunCursor,SyncRunChange} from "@/modules/sources/domain/sync-run-change";
import type {SyncRun} from "@/modules/sources/domain/sync-run";
import {DomainError} from "@/shared/domain/errors";
export type FolderUpdatesPage={runs:{run:SyncRun;sourceName:string;changes:(SyncRunChange&{unread:boolean})[];totalChanges:number}[];nextCursor:RunCursor|null};
export class ListFolderUpdatesService{
 constructor(private readonly uow:SourceUnitOfWork){}
 async list(caller:CallerContext,workspaceId:string,input:{sourceId?:string;unreadOnly?:boolean;cursor?:RunCursor;limit:number;documentsPerRun?:number}):Promise<FolderUpdatesPage>{
  return this.uow.run(async r=>{
   await r.workspaceAccess.requireWorkspaceRead(caller,workspaceId);
   const workspace=await r.workspaces.findById(workspaceId);
   if(workspace?.workspaceType!=="PERSONAL"||workspace.personalOwnerUserId!==caller.identity.id||workspace.lifecycleState!=="ACTIVE")throw new DomainError("WORKSPACE_NOT_FOUND","My Space unavailable.");
   const limit=Math.max(1,Math.min(20,Math.floor(input.limit)||20));
   const runs=await r.syncRunChanges.listAppliedRuns(workspaceId,{sourceId:input.sourceId,cursor:input.cursor,limit:limit+1});
   const selected=runs.slice(0,limit),groups:FolderUpdatesPage["runs"]=[];
   for(const run of selected){
    const source=await r.sources.findById(run.sourceId);if(!source||source.workspaceId!==workspaceId||source.status!=="ACTIVE")continue;
    const changes:SyncRunChange[]=[];let after=0;
    // Read bounded batches; history may have more than 1,000 entries.
    for(;;){const batch=await r.syncRunChanges.listByRun(run.id,after,500);changes.push(...batch.filter(c=>c.kind==="DOCUMENT"&&c.documentId&&c.afterRevisionNo!==null&&(c.labels.includes("ADDED")||c.labels.includes("UPDATED"))&&c.afterRevisionNo>(c.beforeRevisionNo??0)));if(batch.length<500)break;after=batch[batch.length-1].ordinal;}
    const progress=await r.documentReadProgress.getMany(caller.identity.id,workspaceId,changes.map(c=>c.documentId!));const read=new Map(progress.map(p=>[p.documentId,p.revisionNo]));
    const marked=changes.map(c=>({...c,unread:c.afterRevisionNo!>(read.get(c.documentId!)??0)})).filter(c=>!input.unreadOnly||c.unread);
    if(marked.length)groups.push({run,sourceName:source.name,totalChanges:marked.length,changes:input.documentsPerRun?marked.slice(0,input.documentsPerRun):marked});
   }
   const last=selected[selected.length-1];
   return {runs:groups,nextCursor:runs.length>limit&&last?.completedAt?{completedAt:last.completedAt.toISOString(),runId:last.id}:null};
  });
 }
}

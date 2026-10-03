import type {CallerContext} from "@/modules/identity/domain/caller-context";
import type {SourceUnitOfWork} from "../ports/unit-of-work";
import type {SyncRun} from "../domain/sync-run";
import type {SyncRunChange} from "../domain/sync-run-change";
import type {KnowledgeSource} from "../domain/source";
import {buildImportContentDiff,type ImportContentDiff} from "../domain/import-content-diff";
import {DomainError} from "@/shared/domain/errors";
export type SyncRunDetail={run:SyncRun;source:KnowledgeSource;workspaceType:"PERSONAL"|"TEAM";hasRecordedChanges:boolean;changes:(SyncRunChange&{href:string|null;diff:ImportContentDiff|null;revisionUnavailable:boolean})[];nextOrdinal:number|null};
export class GetSyncRunDetailService{
 constructor(private readonly uow:SourceUnitOfWork){}
 async get(caller:CallerContext,workspaceId:string,sourceId:string,runId:string,afterOrdinal=0):Promise<SyncRunDetail>{
  return this.uow.run(async r=>{
   await r.workspaceAccess.requireWorkspaceRead(caller,workspaceId);
   const workspace=await r.workspaces.findById(workspaceId),source=await r.sources.findById(sourceId);
   const run=await r.syncRuns.findById(runId);
   if(!workspace||!source||source.workspaceId!==workspaceId||!run||run.sourceId!==sourceId)throw new DomainError("SOURCE_NOT_FOUND","Sync history unavailable.");
   const rows=await r.syncRunChanges.listByRun(runId,Math.max(0,Math.floor(afterOrdinal)),51);
   const hasRecordedChanges=rows.length>0||(await r.syncRunChanges.listByRun(runId,0,1)).length>0;
   const changes=await Promise.all(rows.slice(0,50).map(async c=>{
    const before=c.beforeRevisionId?await r.revisions.findById(c.beforeRevisionId):null;
    const after=c.afterRevisionId?await r.revisions.findById(c.afterRevisionId):null;
    const selected=after??(!c.afterRevisionId?before:null);
    const revisionUnavailable=Boolean((c.beforeRevisionId&&!before)||(c.afterRevisionId&&!after)||selected&&selected.documentId!==c.documentId);
    return {...c,revisionUnavailable,href:selected&&!revisionUnavailable?`/w/${workspaceId}/knowledge/${sourceId}/${c.documentId}?revision=${selected.revisionNo}&includeArchived=true`:null,diff:!revisionUnavailable&&c.kind==="DOCUMENT"&&(before||after)?buildImportContentDiff(before,after):null};
   }));
   return {run,source,workspaceType:workspace.workspaceType??"TEAM",hasRecordedChanges,changes,nextOrdinal:rows.length>50?changes[changes.length-1].ordinal:null};
  });
 }
}

import type {CallerContext} from "@/modules/identity/domain/caller-context";
import type {SourceUnitOfWork} from "../ports/unit-of-work";
import {buildLinkResolver} from "@/modules/knowledge/domain/link-resolution";
import {DomainError} from "@/shared/domain/errors";
export type SourceHealthPage={sourceName:string;workspaceId:string;sourceId:string;indexIncomplete:boolean;legacyWarnings:number;diagnostics:{id:string;documentId:string|null;title:string;sourcePath:string|null;code:string;message:string;href:string|null}[];nextCursor:string|null};
export class GetSourceHealthService{
 constructor(private readonly uow:SourceUnitOfWork){}
 async get(caller:CallerContext,workspaceId:string,sourceId:string,afterId=""):Promise<SourceHealthPage>{
  return this.uow.run(async r=>{
   await r.workspaceAccess.requireWorkspaceRead(caller,workspaceId);const source=await r.sources.findById(sourceId);
   if(!source||source.workspaceId!==workspaceId||source.status!=="ACTIVE")throw new DomainError("SOURCE_NOT_FOUND","Source unavailable.");
   const [catalog,edges,index,runs]=await Promise.all([r.links.loadCatalog(workspaceId),r.links.loadValidEdges(workspaceId),r.links.countIndexState(workspaceId),r.syncRuns.listBySourceId(sourceId,1,"APPLIED")]);
   const resolver=buildLinkResolver(catalog),byId=new Map(catalog.map(d=>[d.documentId,d]));
   const diagnostics:SourceHealthPage["diagnostics"]=[];
   for(const edge of edges){const doc=byId.get(edge.documentId);if(!doc||doc.sourceId!==sourceId)continue;
    edge.links.forEach((link,i)=>{const resolution=resolver.resolve(link,doc);const code=resolution.status==="UNRESOLVED"?"UNRESOLVED_LINK":resolution.ambiguousWith>0?"AMBIGUOUS_LINK":null;if(code)diagnostics.push({id:`link:${doc.documentId}:${String(i).padStart(8,"0")}`,documentId:doc.documentId,title:doc.title,sourcePath:doc.sourcePath,code,message:`${code==="UNRESOLVED_LINK"?"Cannot resolve":"Multiple articles match"} “${link.target}” (line ${link.line}).`,href:`/w/${workspaceId}/knowledge/${sourceId}/${doc.documentId}`});});
   }
   let legacyWarnings=0;const latest=runs[0];
   if(latest){let after=0,recorded=false;for(;;){const batch=await r.syncRunChanges.listByRun(latest.id,after,500);recorded ||= batch.length>0;for(const c of batch)c.diagnostics.filter(d=>d.severity==="WARNING").forEach((d,i)=>diagnostics.push({id:`warning:${c.id}:${i}`,documentId:c.documentId,title:c.title,sourcePath:c.sourcePath,code:d.code,message:d.message,href:c.documentId?`/w/${workspaceId}/sources/${sourceId}/runs/${latest.id}`:null}));if(batch.length<500)break;after=batch[batch.length-1].ordinal;}
    if(!recorded)legacyWarnings=Number(latest.summary.warnings??0)||0;
   }
   const remaining=diagnostics.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0).filter(d=>d.id>afterId);const selected=remaining.slice(0,50);
   return {sourceName:source.name,workspaceId,sourceId,indexIncomplete:index.stale>0,legacyWarnings,diagnostics:selected,nextCursor:remaining.length>50?selected[selected.length-1].id:null};
  });
 }
}

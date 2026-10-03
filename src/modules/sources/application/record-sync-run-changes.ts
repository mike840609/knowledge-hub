import type { SourceRepositories } from "../ports/unit-of-work";
import type { KnowledgeSource } from "../domain/source";
import type { FolderImportPlan, CanonicalImportState } from "../domain/import-plan";
import type { SyncRunChangeDraft } from "../domain/sync-run-change";
export async function captureAppliedChanges(repositories: SourceRepositories, source: KnowledgeSource, plan: FolderImportPlan, before: CanonicalImportState): Promise<SyncRunChangeDraft[]> {
  const after=await repositories.importCanonicalState.load(source.id);
  const oldByPath=new Map(before.documents.map(d=>[d.sourcePath,d]));
  const newByPath=new Map(after.documents.map(d=>[d.sourcePath,d]));
  const result: SyncRunChangeDraft[]=[];
  for(const change of plan.preview) {
    if(!change.labels.some(label=>label!=="UNCHANGED") && !change.diagnostics.length) continue;
    const previous=change.kind==="DOCUMENT"?oldByPath.get(change.previousPath??change.sourcePath):undefined;
    const current=change.kind==="DOCUMENT"?newByPath.get(change.sourcePath):undefined;
    const oldRevision=previous?.currentRevision, newRevision=current?.currentRevision;
    const beforeRevisionNo=oldRevision ? oldRevision.revisionNo ?? (await repositories.revisions.findById(oldRevision.id))?.revisionNo ?? null : null;
    const afterRevisionNo=newRevision ? newRevision.revisionNo ?? (await repositories.revisions.findById(newRevision.id))?.revisionNo ?? null : null;
    result.push({...change,title:current?.currentRevision.title??previous?.currentRevision.title??change.sourcePath,documentId:current?.documentId??previous?.documentId??null,beforeRevisionId:oldRevision?.id??null,afterRevisionId:newRevision?.id??null,beforeRevisionNo,afterRevisionNo});
  }
  return result;
}

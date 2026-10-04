import { importRuntimeConfig } from "@/server/import-config";
import { getSourceListModel } from "@/server/source-read";
import { resolveAuthoredTitle } from "@/lib/authored-title";
import { applicationServices } from "@/server/composition";
import { PersonalHome } from "@/components/knowledge/personal-home";
import { notFound } from "next/navigation";
export default async function PersonalHomePage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params; const s = applicationServices(); const { caller } = await s.establishTrustedCaller();
  const state = await s.workspaceAdmin.workspaceState(caller, workspaceId);
  if (state.workspace.type !== "PERSONAL") notFound();
  const items = await s.personal.list(caller, workspaceId);
  const documents = (await s.queries.listDocumentSummaries(caller, workspaceId)).map(doc => ({ ...doc, updatedAt: doc.updatedAt.toISOString() }));
  const drafts = items.filter(i => i.key.startsWith("draft:") && i.value).map(i => ({ key: i.key, title: resolveAuthoredTitle({ metadataTitle: undefined, markdown: String(i.value?.markdown ?? ""), typedTitle: String(i.value?.title ?? "") }).title || "Untitled draft", sourceId: "sourceId" in i ? String(i.sourceId) : null, updatedAt: i.updatedAt }));
  const folderModel=await getSourceListModel(workspaceId);
  const updates=await s.folderUpdates.list(caller,workspaceId,{limit:3,documentsPerRun:5});
  const locations=await s.unitOfWork.run(r=>r.entries.findByDocumentIds(documents.map(d=>d.documentId)));
  const paths=new Map(locations.map(e=>[e.documentId,e.sourcePath]));
  const sourceNames=new Map(folderModel?.items.map(i=>[i.source.id,i.source.name])??[]);
  const {limits}=importRuntimeConfig();
  return <PersonalHome limits={{maxAssetFileBytes:limits.maxAssetFileBytes,maxAssetTotalBytes:limits.maxAssetTotalBytes}} workspaceId={workspaceId} documents={documents.map(d=>({...d,sourceName:sourceNames.get(d.sourceId),sourcePath:paths.get(d.documentId)}))} drafts={drafts} folders={folderModel?.items??[]} updates={updates} />;
}

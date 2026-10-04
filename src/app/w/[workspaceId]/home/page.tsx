import type { ReactNode } from "react";
import { importRuntimeConfig } from "@/server/import-config";
import { getSourceListModel } from "@/server/source-read";
import { FreshnessReminders } from "@/components/knowledge/freshness-reminders";
import { FRESHNESS_KEY, freshnessThreshold } from "@/modules/personal/application/knowledge-freshness";
import { resolveAuthoredTitle } from "@/lib/authored-title";
import { applicationServices } from "@/server/composition";
import { PersonalHome } from "@/components/knowledge/personal-home";
import { notFound } from "next/navigation";
export default async function PersonalHomePage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params; const s = applicationServices(); const { caller } = await s.establishTrustedCaller();
  const slots: { guidance?: ReactNode; reminders?: ReactNode } = {};
  const state = await s.workspaceAdmin.workspaceState(caller, workspaceId);
  if (state.workspace.type !== "PERSONAL") notFound();
  const profile = await s.personalProfile.get(caller, workspaceId);
  const freshness = await s.personalPreferences.get(caller, workspaceId, FRESHNESS_KEY);
  const items = await s.personal.list(caller, workspaceId);
  const documents = (await s.queries.listDocumentSummaries(caller, workspaceId)).map(doc => ({ ...doc, updatedAt: doc.updatedAt.toISOString() }));
  const drafts = items.filter(i => i.key.startsWith("draft:") && i.value).map(i => ({ key: i.key, title: resolveAuthoredTitle({ metadataTitle: undefined, markdown: String(i.value?.markdown ?? ""), typedTitle: String(i.value?.title ?? "") }).title || "Untitled draft", sourceId: "sourceId" in i ? String(i.sourceId) : null, updatedAt: i.updatedAt }));
  const folderModel=await getSourceListModel(workspaceId);
  const updates=await s.folderUpdates.list(caller,workspaceId,{limit:3,documentsPerRun:5});
  const locations=await s.unitOfWork.run(r=>r.entries.findByDocumentIds(documents.map(d=>d.documentId)));
  const paths=new Map(locations.map(e=>[e.documentId,e.sourcePath]));
  const sourceNames=new Map(folderModel?.items.map(i=>[i.source.id,i.source.name])??[]);
  slots.reminders = <FreshnessReminders workspaceId={workspaceId} items={folderModel?.items ?? []} preference={{ thresholdDays: freshnessThreshold(freshness.value), version: freshness.version }} now={new Date().toISOString()} />;
  const {limits}=importRuntimeConfig();
  return <PersonalHome slots={slots} profileCounts={profile.counts} limits={{maxAssetFileBytes:limits.maxAssetFileBytes,maxAssetTotalBytes:limits.maxAssetTotalBytes}} workspaceId={workspaceId} documents={documents.map(d=>({...d,sourceName:sourceNames.get(d.sourceId),sourcePath:paths.get(d.documentId)}))} drafts={drafts} folders={folderModel?.items??[]} updates={updates} />;
}

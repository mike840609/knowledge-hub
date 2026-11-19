import { getOnboardingProgress } from "@/server/onboarding-progress";
import type { ReactNode } from "react";
import { getSourceListModel } from "@/server/source-read";
import { FRESHNESS_KEY, freshnessThreshold, knowledgeFreshness } from "@/modules/personal/application/knowledge-freshness";
import { resolveAuthoredTitle } from "@/lib/authored-title";
import { documentsForHome } from "@/lib/home-continue";
import { applicationServices } from "@/server/composition";
import { PersonalHome } from "@/components/knowledge/personal-home";
import { notFound } from "next/navigation";
import { FirstUseGuidance } from "@/components/knowledge/first-use-guidance";
import { getHomeOnboardingState } from "@/server/onboarding-state";
import { unreadHomeNotices } from "@/server/home-notices";
export default async function PersonalHomePage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params; const s = applicationServices(); const { caller } = await s.establishTrustedCaller();
  const slots: { guidance?: ReactNode } = {};
  const state = await s.workspaceAdmin.workspaceState(caller, workspaceId);
  if (state.workspace.type !== "PERSONAL") notFound();
  const profile = await s.personalProfile.get(caller, workspaceId);
  const freshness = await s.personalPreferences.get(caller, workspaceId, FRESHNESS_KEY);
  const items = await s.personal.list(caller, workspaceId);
  const allDocuments = (await s.queries.listDocumentSummaries(caller, workspaceId, { includeArchived: true }))
    .map(doc => ({ ...doc, updatedAt: doc.updatedAt.toISOString() }));
  const activeDocuments = allDocuments.filter(doc => doc.status === "ACTIVE" && doc.sourceStatus === "ACTIVE");
  const drafts = items.filter(i => i.key.startsWith("draft:") && i.value).map(i => ({ key: i.key, title: resolveAuthoredTitle({ metadataTitle: undefined, markdown: String(i.value?.markdown ?? ""), typedTitle: String(i.value?.title ?? "") }).title || "Untitled draft", sourceId: "sourceId" in i ? String(i.sourceId) : null, updatedAt: i.updatedAt }));
  const homeDocuments = documentsForHome(allDocuments, drafts);
  const folderModel=await getSourceListModel(workspaceId);
  const folderIds = new Set(folderModel?.items.filter(item => item.source.sourceType === "FOLDER_SYNC").map(item => item.source.id));
  const firstReadableDocument = activeDocuments.find(doc => folderIds.has(doc.sourceId)) ?? activeDocuments[0];
  const progress = await getOnboardingProgress(s.personalPreferences, caller, workspaceId);
  const onboarding = await getHomeOnboardingState(s.personalPreferences, caller, workspaceId,
    activeDocuments.length > 0 || items.some(item => !item.key.startsWith("prefs:")) || (folderModel?.items.length ?? 0) > 0 || profile.counts.archived > 0 || profile.sync.pending > 0 || progress.read || progress.search || progress.context);
  slots.guidance = <FirstUseGuidance key={onboarding.version} workspaceId={workspaceId} initial={onboarding} imported={folderIds.size > 0} progress={progress} firstDocumentHref={firstReadableDocument ? `/w/${workspaceId}/knowledge/${firstReadableDocument.sourceId}/${firstReadableDocument.documentId}` : undefined} />;
  const locations=await s.unitOfWork.run(r=>r.entries.findByDocumentIds(activeDocuments.map(d=>d.documentId)));
  const paths=new Map(locations.map(e=>[e.documentId,e.sourcePath]));
  const sourceNames=new Map(folderModel?.items.map(i=>[i.source.id,i.source.name])??[]);
  const reminders = knowledgeFreshness(folderModel?.items ?? [], freshnessThreshold(freshness.value), new Date());
  const notices = await unreadHomeNotices(s.reviews, caller);
  return <PersonalHome guidanceDismissed={onboarding.value.dismissed} slots={slots} workspaceId={workspaceId} documents={homeDocuments.map(d=>({...d,sourceName:sourceNames.get(d.sourceId),sourcePath:paths.get(d.documentId)}))} drafts={drafts} reminders={reminders} notices={notices} />;
}

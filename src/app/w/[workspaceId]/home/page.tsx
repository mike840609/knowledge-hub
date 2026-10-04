import { getSourceListModel } from "@/server/source-read";
import { importRuntimeConfig } from "@/server/import-config";
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
  const sources = await getSourceListModel(workspaceId);
  const { maxAssetFileBytes, maxAssetTotalBytes } = importRuntimeConfig().limits;
  return <PersonalHome workspaceId={workspaceId} documents={documents} drafts={drafts} sources={sources?.items ?? []} limits={{ maxAssetFileBytes, maxAssetTotalBytes }} />;
}

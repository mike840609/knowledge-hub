import { resolveAuthoredTitle } from "@/lib/authored-title";
import { applicationServices } from "@/server/composition";
import { PersonalHome } from "@/components/knowledge/personal-home";
import { notFound } from "next/navigation";
export default async function PersonalHomePage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params; const s = applicationServices(); const { caller } = await s.establishTrustedCaller();
  const state = await s.workspaceAdmin.workspaceState(caller, workspaceId);
  if (state.workspace.type !== "PERSONAL") notFound();
  const items = await s.personal.list(caller, workspaceId);
  const documents: { documentId: string; sourceId: string; title: string; updatedAt: string }[] = [];
  for (const source of await s.queries.listSources(caller, workspaceId)) {
    for (const node of await s.queries.listTree(caller, source.id)) {
      if (node.type !== "document") continue;
      const revision = await s.queries.getCurrentRevision(caller, node.documentId);
      documents.push({ documentId: node.documentId, sourceId: source.id, title: revision.title, updatedAt: revision.createdAt.toISOString() });
    }
  }
  documents.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const drafts = items.filter(i => i.key.startsWith("draft:") && i.value).map(i => ({ key: i.key, title: resolveAuthoredTitle({ metadataTitle: undefined, markdown: String(i.value?.markdown ?? ""), typedTitle: String(i.value?.title ?? "") }).title || "Untitled draft", sourceId: "sourceId" in i ? String(i.sourceId) : null, updatedAt: i.updatedAt }));
  return <PersonalHome workspaceId={workspaceId} documents={documents} drafts={drafts} />;
}

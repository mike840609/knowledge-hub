import { KnowledgeEmptyState } from "@/components/knowledge/knowledge-empty-state";
import { KnowledgeLayout } from "@/components/knowledge/knowledge-layout";
import { redirect, notFound } from "next/navigation";
import { getDefaultKnowledgeTarget, getKnowledgeExplorerModel } from "@/server/knowledge-read";
import { applicationServices } from "@/server/composition";

export default async function WorkspaceKnowledgePage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const services = applicationServices();
  const { caller } = await services.establishTrustedCaller();
  const workspaces = await services.workspaces.listWorkspaces(caller);
  if (!workspaces.some((workspace) => workspace.id === workspaceId)) notFound();
  const sources = await services.queries.listSources(caller, workspaceId);
  // The explorer comes too: in an empty workspace it is where the ways to add a document are offered.
  if (sources.length === 0) return <KnowledgeLayout workspaceId={workspaceId} source={null} collections={[]} includeArchived={false}><KnowledgeEmptyState /></KnowledgeLayout>;
  const target = await getDefaultKnowledgeTarget(workspaceId);
  if (target) redirect(`/w/${workspaceId}/knowledge/${target.sourceId}/${target.documentId}`);
  const firstByName = [...sources].sort((left, right) =>
    left.name !== right.name
      ? left.name < right.name
        ? -1
        : 1
      : left.id < right.id
        ? -1
        : left.id > right.id
          ? 1
          : 0,
  )[0];
  if (firstByName) {
    const model = await getKnowledgeExplorerModel(workspaceId, firstByName.id);
    if (model) redirect(`/w/${workspaceId}/knowledge/${firstByName.id}`);
  }
  return <KnowledgeEmptyState />;
}

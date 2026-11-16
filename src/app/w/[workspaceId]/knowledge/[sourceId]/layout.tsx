import { WorkspaceNotFound } from "@/components/shell/workspace-not-found";
import type { ReactNode } from "react";
import { KnowledgeLayout } from "@/components/knowledge/knowledge-layout";
import { getKnowledgeExplorerModel } from "@/server/knowledge-read";

export default async function SourceExplorerLayout({
  params,
  children,
}: {
  params: Promise<{ workspaceId: string; sourceId: string }>;
  children: ReactNode;
}) {
  const { workspaceId, sourceId } = await params;
  // Layouts cannot read search params, so load the inclusive dataset once and
  // let the client sidebar keep archived nodes out of the DOM unless
  // `?includeArchived=true` is present. The sidebar lives outside the child
  // Document route, so Tree client state survives Document navigation.
  const model = await getKnowledgeExplorerModel(workspaceId, sourceId, { includeArchived: true, includeCollections: true });
  if (!model) {
    return (
      <main className="flex min-h-full flex-col justify-center">
        <WorkspaceNotFound />
      </main>
    );
  }
  return (
    <KnowledgeLayout
      workspaceId={workspaceId}
      source={model.source}
      sources={model.sources}
      collections={model.collections}
      includeArchived={model.includeArchived}
    >
      {children}
    </KnowledgeLayout>
  );
}

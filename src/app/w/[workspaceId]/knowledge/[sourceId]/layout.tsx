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
      <main className="mx-auto flex min-h-full max-w-4xl flex-col justify-center px-6 py-16">
        <h1 className="text-2xl font-semibold">Not found or no access</h1>
      </main>
    );
  }
  return (
    <KnowledgeLayout
      workspaceId={workspaceId}
      source={model.source}
      collections={model.collections}
      includeArchived={model.includeArchived}
    >
      {children}
    </KnowledgeLayout>
  );
}

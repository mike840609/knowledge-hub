import type { ReactNode } from "react";
import { KnowledgeLayout } from "@/components/knowledge/knowledge-layout";
import { getKnowledgeExplorerModel } from "@/server/knowledge-read";
import { StatusMessage } from "@/components/ui/status-message";

export default async function SourceExplorerLayout({
  params,
  children,
}: {
  params: Promise<{ workspaceId: string; sourceId: string }>;
  children: ReactNode;
}) {
  const { workspaceId, sourceId } = await params;
  // Only decides whether this source is here to read; the sidebar's trees come from the workspace layout.
  const model = await getKnowledgeExplorerModel(workspaceId, sourceId, { includeArchived: true });
  if (!model) {
    return (
      <main className="flex min-h-full flex-col justify-center">
        <StatusMessage
          title="Not found or no access"
          description="This content does not exist or you do not have access to it."
        />
      </main>
    );
  }
  return <KnowledgeLayout>{children}</KnowledgeLayout>;
}

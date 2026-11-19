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
  // Validate the source's route scope. The document page reuses this request's
  // inclusive read for its breadcrumb and edit permissions.
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

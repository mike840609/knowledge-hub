import Link from "next/link";
import { redirect } from "next/navigation";
import { findFirstReadableDocument } from "@/lib/knowledge-navigation";
import { getKnowledgeExplorerModel } from "@/server/knowledge-read";
import { buttonClasses } from "@/components/ui/button";
import { StatusMessage } from "@/components/ui/status-message";

export default async function SourceKnowledgePage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string; sourceId: string }>;
  searchParams?: Promise<{ includeArchived?: string }>;
}) {
  const { workspaceId, sourceId } = await params;
  const query = await searchParams;
  const includeArchived = query?.includeArchived === "true";
  const archivedSuffix = includeArchived ? "?includeArchived=true" : "";
  const model = await getKnowledgeExplorerModel(workspaceId, sourceId, { includeArchived });
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
  const first = findFirstReadableDocument(model.tree);
  if (first) redirect(`/w/${workspaceId}/knowledge/${sourceId}/${first.documentId}${archivedSuffix}`);
  return (
    <main className="flex min-h-full flex-col justify-center">
      <StatusMessage
        title={model.source.name}
        description="This source does not contain any readable documents."
        action={
          <Link
            className={buttonClasses({ variant: "secondary", size: "lg" })}
            href={`/w/${workspaceId}/sources`}
          >
            Go to Sources
          </Link>
        }
      />
    </main>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { findFirstReadableDocument } from "@/lib/knowledge-navigation";
import { getKnowledgeExplorerModel } from "@/server/knowledge-read";
import { buttonClasses } from "@/components/ui/button";

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
      <main className="mx-auto flex min-h-full max-w-4xl flex-col justify-center px-6 py-16">
        <h1 className="text-heading font-semibold">Not found or no access</h1>
      </main>
    );
  }
  const first = findFirstReadableDocument(model.tree);
  if (first) redirect(`/w/${workspaceId}/knowledge/${sourceId}/${first.documentId}${archivedSuffix}`);
  return (
    <main className="mx-auto flex min-h-full max-w-4xl flex-col justify-center px-6 py-16">
      <h1 className="text-heading font-semibold">{model.source.name}</h1>
      <p className="mt-4 text-kh-text-muted">This source does not contain any readable documents.</p>
      <Link
        className={buttonClasses({ variant: "secondary", size: "lg", className: "mt-6 w-fit" })}
        href={`/w/${workspaceId}/sources`}
      >
        Go to Sources
      </Link>
    </main>
  );
}

import { notFound } from "next/navigation";
import { WorkspaceImportLink } from "@/components/shell/workspace-import-link";
import { SourceList } from "@/components/sources/source-list";
import { getSourceListModel } from "@/server/source-read";

export default async function WorkspaceSourcesPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const model = await getSourceListModel(workspaceId);
  if (!model) notFound();
  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-kh-text">Sources</h1>
          <p className="mt-1 text-sm text-kh-text-muted">
            {model.items.length} {model.items.length === 1 ? "source" : "sources"} in {model.workspace.name}
          </p>
        </div>
        <WorkspaceImportLink
          className="inline-flex items-center rounded-md border border-kh-border bg-kh-bg px-3 py-2 text-sm font-medium text-kh-text transition hover:bg-kh-bg-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-kh-accent"
          href={`/w/${workspaceId}/sources/import`}
        >
          Import folder
        </WorkspaceImportLink>
      </div>
      <div className="mt-5">
        <SourceList workspaceId={workspaceId} items={model.items} />
      </div>
    </main>
  );
}

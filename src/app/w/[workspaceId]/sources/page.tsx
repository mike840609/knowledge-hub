import { notFound } from "next/navigation";
import { WorkspaceImportLink } from "@/components/shell/workspace-import-link";
import { SourceList } from "@/components/sources/source-list";
import { getSourceListModel } from "@/server/source-read";
import { PageHeader } from "@/components/shell/page-header";

export default async function WorkspaceSourcesPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const model = await getSourceListModel(workspaceId);
  if (!model) notFound();
  return (
    <main className="mx-auto max-w-4xl px-6 py-6">
      <PageHeader
        location={model.workspace.name}
        locationHref={`/w/${workspaceId}/knowledge`}
        title="Manage sources"
        description={`${model.items.length} ${model.items.length === 1 ? "source" : "sources"}`}
        actions={<WorkspaceImportLink
          className="inline-flex items-center rounded-md border border-kh-border bg-kh-bg px-3 py-2 text-body font-medium text-kh-text transition hover:bg-kh-bg-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-kh-focus"
          href={`/w/${workspaceId}/sources/import`}
        >
          Import folder
        </WorkspaceImportLink>}
      />
      <div className="mt-6">
        <SourceList workspaceId={workspaceId} items={model.items} />
      </div>
    </main>
  );
}

import { importRuntimeConfig } from "@/server/import-config";
import { notFound } from "next/navigation";
import { WorkspaceImportLink } from "@/components/shell/workspace-import-link";
import { SourceList } from "@/components/sources/source-list";
import { getSourceListModel } from "@/server/source-read";
import { PageHeader } from "@/components/shell/page-header";
import { buttonClasses } from "@/components/ui/button";

export default async function WorkspaceSourcesPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const model = await getSourceListModel(workspaceId);
  if (!model) notFound();
  const limits = importRuntimeConfig().limits;
  return (
    <main className="kh-page py-6">
      <PageHeader
        location={model.workspace.name}
        locationHref={`/w/${workspaceId}/knowledge`}
        title="Sources"
        description={`${model.items.length} ${model.items.length === 1 ? "source" : "sources"}`}
        // The empty state carries the same action as its primary; two of them on one screen is one too many.
        actions={model.items.length === 0 ? undefined : <WorkspaceImportLink
          className={buttonClasses({ variant: "secondary" })}
          href={`/w/${workspaceId}/sources/import`}
        >
          Import folder
        </WorkspaceImportLink>}
      />
      <div className="mt-6">
        <SourceList workspaceId={workspaceId} items={model.items} limits={{ maxAssetFileBytes: limits.maxAssetFileBytes, maxAssetTotalBytes: limits.maxAssetTotalBytes }} />
      </div>
    </main>
  );
}

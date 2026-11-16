import { WorkspaceNotFound } from "@/components/shell/workspace-not-found";
import { PageHeader } from "@/components/shell/page-header";
import { FolderImportForm } from "@/components/imports/folder-import-form";
import { isFolderSyncable } from "@/modules/knowledge/domain/source-policy";
import { getSourceDetailModel } from "@/server/source-read";
import { importRuntimeConfig } from "@/server/import-config";

export default async function WorkspaceSourceUpdatePage({
  params,
}: {
  params: Promise<{ workspaceId: string; sourceId: string }>;
}) {
  const { workspaceId, sourceId } = await params;
  const model = await getSourceDetailModel(workspaceId, sourceId);
  const importLimits = importRuntimeConfig().limits;
  if (!model || !isFolderSyncable(model.source)) {
    return (
      <main className="flex min-h-screen flex-col justify-center">
        <WorkspaceNotFound />
      </main>
    );
  }
  return (
    <main className="kh-page pb-6">
      <PageHeader location={model.source.name} locationHref={`/w/${workspaceId}/sources/${sourceId}`} title="Update from folder" />
      <div className="mt-5">
        {model.actions.canImport ? <FolderImportForm
          target={{ kind: "existing", workspaceId, sourceId: model.source.id, sourceName: model.source.name }}
          limits={{ maxMarkdownFileBytes: importLimits.maxMarkdownFileBytes, maxAssetFileBytes: importLimits.maxAssetFileBytes, maxAssetTotalBytes: importLimits.maxAssetTotalBytes }}
        /> : <p role="status">This workspace is read-only. Updating is unavailable.</p>}
      </div>
    </main>
  );
}

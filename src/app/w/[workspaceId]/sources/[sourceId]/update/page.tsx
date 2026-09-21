import Link from "next/link";
import { FolderImportForm } from "@/components/imports/folder-import-form";
import { isFolderSyncable } from "@/modules/knowledge/domain/source-policy";
import { getSourceDetailModel } from "@/server/source-read";
import { StatusMessage } from "@/components/ui/status-message";

export default async function WorkspaceSourceUpdatePage({
  params,
}: {
  params: Promise<{ workspaceId: string; sourceId: string }>;
}) {
  const { workspaceId, sourceId } = await params;
  const model = await getSourceDetailModel(workspaceId, sourceId);
  if (!model || !isFolderSyncable(model.source)) {
    return (
      <main className="flex min-h-screen flex-col justify-center">
        <StatusMessage
          title="Not found or no access"
          description="This content does not exist or you do not have access to it."
        />
      </main>
    );
  }
  return (
    <main className="kh-page py-6">
      <Link className="w-fit rounded-md text-body font-medium text-kh-text-muted underline-offset-4 hover:underline kh-focus-ring" href={`/w/${workspaceId}/sources/${sourceId}`}>
        Back to {model.source.name}
      </Link>
      <h1 className="mt-3 text-heading font-semibold text-kh-text">Update from folder</h1>
      <p className="mt-1 text-body text-kh-text-muted">
        Sync version {model.source.syncVersion}. Re-select the full folder to preview the next sync.
      </p>
      <div className="mt-5">
        {model.actions.canImport ? <FolderImportForm
          target={{ kind: "existing", workspaceId, sourceId: model.source.id, sourceName: model.source.name }}
        /> : <p role="status">This workspace is read-only. Updating is unavailable.</p>}
      </div>
    </main>
  );
}

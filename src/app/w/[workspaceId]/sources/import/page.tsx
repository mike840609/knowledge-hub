import { PageHeader } from "@/components/shell/page-header";
import Link from "next/link";
import { ImportFlowGuide } from "@/components/imports/import-flow-guide";
import { FolderImportForm } from "@/components/imports/folder-import-form";
import { getSourceListModel } from "@/server/source-read";
import { StatusMessage } from "@/components/ui/status-message";
import { importRuntimeConfig } from "@/server/import-config";

export default async function WorkspaceSourceImportPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const model = await getSourceListModel(workspaceId);
  const importLimits = importRuntimeConfig().limits;
  if (!model) {
    return (
      <main className="flex min-h-screen flex-col justify-center">
        <StatusMessage
          title="No workspace access"
          description="You do not have access to this workspace, or it no longer exists."
        />
      </main>
    );
  }
  return (
    <main className="kh-page pb-6">
      <PageHeader location="Sources" locationHref={`/w/${workspaceId}/sources`} title="Import folder" />
      <p className="mt-1 text-body text-kh-text-muted">
        Your local files stay unchanged.{" "}
        <Link className="rounded-md text-kh-link underline-offset-4 hover:underline kh-focus-ring" href={`/w/${workspaceId}/sources/import/guide`}>Folder format guide</Link>
      </p>
      <ImportFlowGuide />
      <div className="mt-5">
        {model.actions.canImport ? <FolderImportForm
          target={{ kind: "new", workspaceId }}
          limits={{ maxAssetFileBytes: importLimits.maxAssetFileBytes, maxAssetTotalBytes: importLimits.maxAssetTotalBytes }}
        /> : <p role="status">This workspace is read-only. Import is unavailable.</p>}
      </div>
    </main>
  );
}

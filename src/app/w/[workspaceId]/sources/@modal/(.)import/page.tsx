import { ImportFolderDialog } from "@/components/imports/import-folder-dialog";
import { StatusMessage } from "@/components/ui/status-message";
import { importRuntimeConfig } from "@/server/import-config";
import { getWorkspaceShellModel } from "@/server/knowledge-read";

export default async function InterceptedWorkspaceSourceImportPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const shell = await getWorkspaceShellModel(workspaceId);
  if (!shell) {
    return (
      <main className="flex min-h-screen flex-col justify-center">
        <StatusMessage
          title="No workspace access"
          description="You do not have access to this workspace, or it no longer exists."
        />
      </main>
    );
  }
  const limits = importRuntimeConfig().limits;
  return (
    <ImportFolderDialog
      workspaceId={workspaceId}
      canImport={shell.access.actions.canImport}
      limits={{
        maxMarkdownFileBytes: limits.maxMarkdownFileBytes,
        maxAssetFileBytes: limits.maxAssetFileBytes,
        maxAssetTotalBytes: limits.maxAssetTotalBytes,
      }}
    />
  );
}

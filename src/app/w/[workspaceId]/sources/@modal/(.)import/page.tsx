import { notFound } from "next/navigation";
import { ImportFolderDialog } from "@/components/imports/import-folder-dialog";
import { importRuntimeConfig } from "@/server/import-config";
import { getWorkspaceShellModel } from "@/server/knowledge-read";

export default async function InterceptedWorkspaceSourceImportPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const shell = await getWorkspaceShellModel(workspaceId);
  if (!shell) notFound();
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

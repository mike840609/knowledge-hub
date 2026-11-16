import { WorkspaceNotFound } from "@/components/shell/workspace-not-found";
import { importRuntimeConfig } from "@/server/import-config";
import { SourceDetail } from "@/components/sources/source-detail";
import { getSourceDetailModel } from "@/server/source-read";

export default async function WorkspaceSourceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string; sourceId: string }>;
  searchParams: Promise<{ import?: string }>;
}) {
  const { workspaceId, sourceId } = await params;
  const { import: importParam } = await searchParams;
  const model = await getSourceDetailModel(workspaceId, sourceId);
  if (!model) {
    return (
      <main className="flex min-h-screen flex-col justify-center">
        <WorkspaceNotFound />
      </main>
    );
  }
  const limits = importRuntimeConfig().limits;
  return (
    <main className="kh-page pb-6">
      <SourceDetail limits={{ maxMarkdownFileBytes: limits.maxMarkdownFileBytes, maxAssetFileBytes: limits.maxAssetFileBytes, maxAssetTotalBytes: limits.maxAssetTotalBytes }} model={model} showImportSuccess={importParam === "success"} />
    </main>
  );
}

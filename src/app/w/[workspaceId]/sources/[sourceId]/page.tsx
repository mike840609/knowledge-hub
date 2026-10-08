import { importRuntimeConfig } from "@/server/import-config";
import { SourceDetail } from "@/components/sources/source-detail";
import { getSourceDetailModel } from "@/server/source-read";
import { StatusMessage } from "@/components/ui/status-message";

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
        <StatusMessage
          title="Not found or no access"
          description="This content does not exist or you do not have access to it."
        />
      </main>
    );
  }
  const limits = importRuntimeConfig().limits;
  return (
    <main className="kh-page pb-6">
      <SourceDetail limits={{ maxAssetFileBytes: limits.maxAssetFileBytes, maxAssetTotalBytes: limits.maxAssetTotalBytes }} model={model} showImportSuccess={importParam === "success"} />
    </main>
  );
}

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
      <main className="mx-auto flex min-h-screen max-w-4xl flex-col justify-center px-6 py-16">
        <h1 className="text-heading font-semibold">Not found or no access</h1>
      </main>
    );
  }
  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <SourceDetail model={model} showImportSuccess={importParam === "success"} />
    </main>
  );
}

import { SourceDetail } from "@/components/sources/source-detail";
import { getSourceDetailModel } from "@/server/source-read";

export default async function WorkspaceSourceDetailPage({
  params,
}: {
  params: Promise<{ workspaceId: string; sourceId: string }>;
}) {
  const { workspaceId, sourceId } = await params;
  const model = await getSourceDetailModel(workspaceId, sourceId);
  if (!model) {
    return (
      <main className="mx-auto flex min-h-screen max-w-4xl flex-col justify-center px-6 py-16">
        <h1 className="text-2xl font-semibold">Not found or no access</h1>
      </main>
    );
  }
  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <SourceDetail model={model} />
    </main>
  );
}

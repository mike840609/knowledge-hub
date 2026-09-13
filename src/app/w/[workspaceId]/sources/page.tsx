import { SourceList } from "@/components/sources/source-list";
import { getSourceListModel } from "@/server/source-read";

export default async function WorkspaceSourcesPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const model = await getSourceListModel(workspaceId);
  if (!model) {
    return (
      <main className="mx-auto flex min-h-screen max-w-4xl flex-col justify-center px-6 py-16">
        <h1 className="text-2xl font-semibold">No workspace access</h1>
      </main>
    );
  }
  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="text-2xl font-semibold text-kh-text">Sources</h1>
      <p className="mt-1 text-sm text-kh-text-muted">
        {model.items.length} {model.items.length === 1 ? "source" : "sources"} in {model.workspace.name}
      </p>
      <div className="mt-5">
        <SourceList workspaceId={workspaceId} items={model.items} />
      </div>
    </main>
  );
}

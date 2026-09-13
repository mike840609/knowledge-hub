import Link from "next/link";
import { FolderImportForm } from "@/components/imports/folder-import-form";
import { getSourceDetailModel } from "@/server/source-read";

export default async function WorkspaceSourceUpdatePage({
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
      <Link className="w-fit rounded text-sm font-medium text-kh-text-muted underline-offset-4 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-kh-accent" href={`/w/${workspaceId}/sources/${sourceId}`}>
        Back to {model.source.name}
      </Link>
      <h1 className="mt-3 text-2xl font-semibold text-kh-text">Update from folder</h1>
      <p className="mt-1 text-sm text-kh-text-muted">
        Sync version {model.source.syncVersion}. Re-select the full folder to preview the next sync.
      </p>
      <div className="mt-5">
        <FolderImportForm
          target={{ kind: "existing", workspaceId, sourceId: model.source.id, sourceName: model.source.name }}
        />
      </div>
    </main>
  );
}

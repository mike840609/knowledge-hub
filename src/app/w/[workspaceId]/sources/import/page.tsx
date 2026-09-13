import Link from "next/link";
import { FolderImportForm } from "@/components/imports/folder-import-form";
import { getSourceListModel } from "@/server/source-read";

export default async function WorkspaceSourceImportPage({
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
      <Link className="text-sm font-medium text-kh-text-muted" href={`/w/${workspaceId}/sources`}>
        Back to Sources
      </Link>
      <h1 className="mt-3 text-2xl font-semibold text-kh-text">Import folder</h1>
      <p className="mt-1 text-sm text-kh-text-muted">
        Choose a local folder to create a source in {model.workspace.name}. The source folder stays authoritative;
        the Hub only previews the deterministic diff before anything is applied.
      </p>
      <div className="mt-5">
        <FolderImportForm target={{ kind: "new", workspaceId }} />
      </div>
    </main>
  );
}

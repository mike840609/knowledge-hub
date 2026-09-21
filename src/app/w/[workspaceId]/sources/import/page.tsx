import Link from "next/link";
import { FolderImportForm } from "@/components/imports/folder-import-form";
import { getSourceListModel } from "@/server/source-read";
import { StatusMessage } from "@/components/ui/status-message";

export default async function WorkspaceSourceImportPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const model = await getSourceListModel(workspaceId);
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
    <main className="kh-page py-6">
      <Link className="w-fit rounded-md text-body font-medium text-kh-text-muted underline-offset-4 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-kh-focus" href={`/w/${workspaceId}/sources`}>
        Back to Sources
      </Link>
      <h1 className="mt-3 text-heading font-semibold text-kh-text">Import folder</h1>
      <p className="mt-1 text-body text-kh-text-muted">
        Choose a local folder to create a source in {model.workspace.name}. The source folder stays authoritative;
        the Hub only previews the deterministic diff before anything is applied.
      </p>
      <div className="mt-5">
        {model.actions.canImport ? <FolderImportForm target={{ kind: "new", workspaceId }} /> : <p role="status">This workspace is read-only. Import is unavailable.</p>}
      </div>
    </main>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { ResourceAccessDenied } from "@/components/errors/resource-access-denied";
import { ImportPreview } from "@/components/imports/import-preview";
import { classifyImportPreviewPageError } from "@/server/import-preview-page-error";
import { getSourceImportPreview } from "@/server/source-imports";

export const dynamic = "force-dynamic";

export default async function WorkspaceSourceImportPreviewPage({
  params,
}: {
  params: Promise<{ workspaceId: string; snapshotId: string }>;
}) {
  const { workspaceId, snapshotId } = await params;
  let preview;
  try {
    preview = await getSourceImportPreview(snapshotId);
  } catch (error) {
    const state = classifyImportPreviewPageError(error);
    if (state === "NOT_FOUND") notFound();
    if (state === "ACCESS_DENIED") {
      return <ResourceAccessDenied backHref={`/w/${workspaceId}/sources`} />;
    }
    throw error;
  }
  // The Preview carries its own workspaceId; the route Workspace is navigation
  // context only. A mismatch gets the same inaccessible/not-found treatment.
  if (preview.workspaceId !== workspaceId) notFound();
  return (
    <main className="kh-page min-h-screen py-6">
      <Link className="w-fit rounded-md text-body font-medium text-kh-link underline-offset-4 hover:underline kh-focus-ring" href={`/w/${workspaceId}/sources`}>
        Back to Sources
      </Link>
      <h1 className="mt-2 text-heading font-semibold text-kh-text">Import preview</h1>
      <p className="mt-1 text-body text-kh-text-muted">
        Review the immutable staged diff. Warnings may proceed; blockers never apply.
      </p>
      <div className="mt-4">
        <ImportPreview workspaceId={workspaceId} preview={preview} />
      </div>
    </main>
  );
}

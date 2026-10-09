import { PageHeader } from "@/components/shell/page-header";
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
    <main className="kh-page min-h-screen pb-6">
      <PageHeader location="Sources" locationHref={`/w/${workspaceId}/sources`} title="Import preview" />
      <p className="mt-1 text-body text-kh-text-muted">
        Review changes before applying. Resolve blockers to continue.
      </p>
      <details className="mt-2 text-body"><summary className="kh-focus-ring w-fit cursor-pointer rounded-md text-kh-text-muted">Preview help</summary><Link className="kh-focus-ring rounded-md text-kh-link hover:underline" href={`/w/${workspaceId}/help#sync`}>How to review and apply changes</Link></details>
      <div className="mt-4">
        <ImportPreview workspaceId={workspaceId} preview={preview} />
      </div>
    </main>
  );
}

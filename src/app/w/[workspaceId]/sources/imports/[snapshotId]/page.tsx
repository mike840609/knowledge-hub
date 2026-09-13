import Link from "next/link";
import { notFound } from "next/navigation";
import { ImportPreview } from "@/components/imports/import-preview";
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
    if (error instanceof Error && "code" in error && (error as { code: unknown }).code === "IMPORT_SNAPSHOT_NOT_FOUND") notFound();
    throw error;
  }
  // The Preview carries its own workspaceId; the route Workspace is navigation
  // context only. A mismatch gets the same inaccessible/not-found treatment.
  if (preview.workspaceId !== workspaceId) notFound();
  return (
    <main className="mx-auto min-h-screen max-w-4xl px-6 py-8">
      <Link className="text-sm font-medium text-kh-accent" href={`/w/${workspaceId}/sources`}>
        Back to Sources
      </Link>
      <h1 className="mt-2 text-2xl font-semibold text-kh-text">Import preview</h1>
      <p className="mt-1 text-sm text-kh-text-muted">
        Review the immutable staged diff. Warnings may proceed; blockers never apply.
      </p>
      <div className="mt-4">
        <ImportPreview workspaceId={workspaceId} preview={preview} />
      </div>
    </main>
  );
}

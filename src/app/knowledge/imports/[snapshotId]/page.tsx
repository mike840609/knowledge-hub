import Link from "next/link";
import { notFound } from "next/navigation";
import { SourceImportPreview } from "@/components/knowledge/source-import-preview";
import { SourceImportPreviewActions } from "@/components/knowledge/source-import-preview-actions";
import { getSourceImportPreview } from "@/server/source-imports";

export const dynamic = "force-dynamic";

export default async function ImportPreviewPage({ params }: { params: Promise<{ snapshotId: string }> }) {
  const { snapshotId } = await params;
  let preview;
  try {
    preview = await getSourceImportPreview(snapshotId);
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as { code: unknown }).code === "IMPORT_SNAPSHOT_NOT_FOUND") notFound();
    throw error;
  }
  return (
    <main className="mx-auto min-h-screen max-w-6xl space-y-6 px-6 py-10">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-6">
        <div>
          <Link className="text-sm font-semibold text-accent" href="/knowledge">Back to Knowledge</Link>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight text-ink">Import preview</h1>
          <p className="mt-1 text-sm text-slate-500">Review the immutable staged diff. Warnings may proceed; blockers never apply.</p>
        </div>
      </header>
      <SourceImportPreviewActions preview={preview} />
      <SourceImportPreview preview={preview} />
    </main>
  );
}

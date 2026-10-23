import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/shell/page-header";
import { MarkdownArticle } from "@/components/knowledge/markdown-article";
import { DraftRecoveryActions } from "@/components/knowledge/draft-recovery-actions";
import { getDraftRecoveryModel } from "@/server/draft-read";

export default async function DraftRecoveryPage({
  params,
}: {
  params: Promise<{ workspaceId: string; sourceId: string; documentId: string }>;
}) {
  const { workspaceId, sourceId, documentId } = await params;
  const model = await getDraftRecoveryModel(workspaceId, sourceId, documentId);
  if (!model) notFound();
  if (model.document.status === "ACTIVE" && model.document.sourceStatus === "ACTIVE") {
    redirect(`/w/${workspaceId}/knowledge/${sourceId}/${documentId}`);
  }

  const explanation = model.workspaceArchived
    ? "This workspace is archived and read-only. Download or copy the draft before leaving."
    : model.sourceArchived
      ? "The source is archived. Restore the source in Sources before the original document can be edited."
      : !model.canWrite
        ? "You do not have permission to restore the original document. Download or copy the draft instead."
        : "The original document is archived. Restore it to continue editing, or download a copy.";

  return (
    <div className="kh-page space-y-6 pb-6">
      <PageHeader
        location="Home"
        locationHref={`/w/${workspaceId}/home`}
        title={model.draft.title || "Untitled draft"}
        description={explanation}
        actions={<DraftRecoveryActions
          workspaceId={workspaceId}
          sourceId={sourceId}
          documentId={documentId}
          title={model.draft.title || "Untitled draft"}
          markdown={model.draft.markdown}
          canRestore={model.canRestore}
        />}
      />
      <div className="kh-reading-column py-6">
        <MarkdownArticle markdown={model.draft.markdown} />
      </div>
    </div>
  );
}

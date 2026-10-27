import Link from "next/link";
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
  const draft = model.draft;
  if (!draft) {
    const suffix = model.document.status === "ARCHIVED" || model.document.sourceStatus === "ARCHIVED" ? "?includeArchived=true" : "";
    return redirect(`/w/${workspaceId}/knowledge/${sourceId}/${documentId}${suffix}`);
  }
  if (model.document.status === "ACTIVE" && model.document.sourceStatus === "ACTIVE") {
    return redirect(`/w/${workspaceId}/knowledge/${sourceId}/${documentId}`);
  }

  const explanation = model.workspaceArchived
    ? "This workspace is archived and read-only. Download or copy the draft before leaving."
    : model.sourceArchived
      ? "The source is archived. Restore the source in Sources before the original document can be edited."
      : !model.canWrite
        ? "You do not have permission to restore the original document. Download or copy the draft instead."
        : model.document.ownership === "SOURCE_MANAGED"
          ? "This document comes from a synced source and cannot be restored here. Restore it from its source, or download or copy the draft."
          : model.treeNodeMissing
            ? "The document's place in the source is unavailable. Download or copy the draft."
            : model.folderArchived
              ? "The folder holding this document is archived. Restore the folder in Sources first, or download or copy the draft."
              : "The original document is archived. Restore it to continue editing, or download a copy.";

  return (
    <div className="kh-page space-y-6 pb-6">
      <PageHeader
        location="Home"
        locationHref={`/w/${workspaceId}/home`}
        title={draft.title || "Untitled draft"}
        description={explanation}
        actions={<DraftRecoveryActions
          workspaceId={workspaceId}
          sourceId={sourceId}
          documentId={documentId}
          title={draft.title || "Untitled draft"}
          markdown={draft.markdown}
          canRestore={model.canRestore}
        />}
      />
      {(model.sourceArchived || model.folderArchived || model.treeNodeMissing) && !model.workspaceArchived ? (
        <p className="text-body-sm text-kh-text-muted">
          <Link className="kh-focus-ring rounded-md text-kh-link" href={`/w/${workspaceId}/sources/${sourceId}`}>Open Sources</Link>
        </p>
      ) : null}
      <div className="kh-reading-column py-6">
        <MarkdownArticle markdown={draft.markdown} />
      </div>
    </div>
  );
}

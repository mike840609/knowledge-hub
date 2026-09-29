import type { KnowledgeQueryService } from "@/modules/knowledge/application/knowledge-query-service";
import { MarkdownRenderer } from "./markdown-renderer";

type DocumentDetails = Awaited<ReturnType<KnowledgeQueryService["getDocument"]>>;

/** Rendered Markdown as the reader shows it; the composer's preview is this same element. */
export function MarkdownArticle({ markdown }: { markdown: string }) {
  return (
    <article className="min-w-0 [&>div>:first-child]:mt-0">
      <MarkdownRenderer markdown={markdown} />
    </article>
  );
}

export function DocumentViewer({ view, selectedRevision }: { view: DocumentDetails; selectedRevision?: DocumentDetails["currentRevision"] }) {
  const displayed = selectedRevision ?? view.currentRevision;
  return <MarkdownArticle markdown={displayed.markdown} />;
}

import type { KnowledgeQueryService } from "@/modules/knowledge/application/knowledge-query-service";
import { MarkdownRenderer } from "./markdown-renderer";

type DocumentDetails = Awaited<ReturnType<KnowledgeQueryService["getDocument"]>>;

export function DocumentViewer({ view, selectedRevision }: { view: DocumentDetails; selectedRevision?: DocumentDetails["currentRevision"] }) {
  const displayed = selectedRevision ?? view.currentRevision;
  return (
    <article className="min-w-0">
      <MarkdownRenderer markdown={displayed.markdown} />
    </article>
  );
}

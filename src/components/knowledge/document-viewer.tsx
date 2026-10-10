import type { KnowledgeQueryService } from "@/modules/knowledge/application/knowledge-query-service";
import { MARKDOWN_ARTICLE } from "./markdown-article";
import { MarkdownImageBaseProvider } from "./markdown-image-base";
import { MarkdownRenderer } from "./markdown-renderer";
import type { RenderedLinks } from "./rendered-links";

type DocumentDetails = Awaited<ReturnType<KnowledgeQueryService["getDocument"]>>;

export function DocumentViewer({
  view,
  selectedRevision,
  links,
}: {
  view: DocumentDetails;
  selectedRevision?: DocumentDetails["currentRevision"];
  links?: RenderedLinks;
}) {
  const displayed = selectedRevision ?? view.currentRevision;
  return (
    <article className={MARKDOWN_ARTICLE}>
      <MarkdownImageBaseProvider base={`/api/documents/${view.documentId}/asset`}>
        <MarkdownRenderer markdown={displayed.markdown} links={links} />
      </MarkdownImageBaseProvider>
    </article>
  );
}

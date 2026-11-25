import type { KnowledgeQueryService } from "@/modules/knowledge/application/knowledge-query-service";
import { MARKDOWN_ARTICLE } from "./markdown-article";
import { MarkdownRenderer } from "./markdown-renderer";
import { DocumentMetaSlot } from "./document-meta";
import type { RenderedLinks } from "./rendered-links";

type DocumentDetails = Awaited<ReturnType<KnowledgeQueryService["getDocument"]>>;

export function DocumentViewer({
  view,
  selectedRevision,
  links,
  metaAfterTitle = false,
}: {
  view: DocumentDetails;
  selectedRevision?: DocumentDetails["currentRevision"];
  links?: RenderedLinks;
  /** The page's meta line goes right under the `#` title this document opens with (the document page; a peek draws its own header). */
  metaAfterTitle?: boolean;
}) {
  const displayed = selectedRevision ?? view.currentRevision;
  return (
    <article tabIndex={-1} data-review-document className={MARKDOWN_ARTICLE}>
      <MarkdownRenderer markdown={displayed.markdown} links={links} afterTitle={metaAfterTitle ? <DocumentMetaSlot /> : undefined} />
    </article>
  );
}

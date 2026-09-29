import type { KnowledgeQueryService } from "@/modules/knowledge/application/knowledge-query-service";
import { MarkdownRenderer } from "./markdown-renderer";
import type { RenderedLinks } from "./rendered-links";

type DocumentDetails = Awaited<ReturnType<KnowledgeQueryService["getDocument"]>>;

/**
 * Rendered Markdown as the reader shows it; the composer's preview is this same
 * element. `links` says what each link in it points at; a draft has none, so
 * its links are just their text until the document is saved.
 */
export function MarkdownArticle({ markdown, links }: { markdown: string; links?: RenderedLinks }) {
  return (
    <article className="min-w-0 [&>div>:first-child]:mt-0">
      <MarkdownRenderer markdown={markdown} links={links} />
    </article>
  );
}

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
  return <MarkdownArticle markdown={displayed.markdown} links={links} />;
}

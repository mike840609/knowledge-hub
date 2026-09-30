import { MarkdownBase } from "./markdown-base";
import type { RenderedLinks } from "./rendered-links";

/** The element the reader puts rendered Markdown in; the composer's stand-in wears the same one. */
export const MARKDOWN_ARTICLE = "min-w-0 [&>div>:first-child]:mt-0";

/**
 * Rendered Markdown in the reader's article element, without colour in the code or copy buttons:
 * what the composer shows while its editor loads, so that nothing flashes when the editor arrives
 * (composer spec §11.4) and nothing the reader needs is sent to the composer. `links` says what
 * each link in it points at; a draft has none, so its links are just their text until it is saved.
 */
export function MarkdownArticle({ markdown, links }: { markdown: string; links?: RenderedLinks }) {
  return (
    <article className={MARKDOWN_ARTICLE}>
      <MarkdownBase markdown={markdown} links={links} />
    </article>
  );
}

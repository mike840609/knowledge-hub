import type { SharedDocumentView } from "@/modules/knowledge/application/document-share-service";
import { markdownOpensWithHeading } from "@/lib/markdown-title";
import { expiresSoon } from "@/lib/share-expiry";
import { extractOutline } from "@/shared/markdown/outline";
import { buttonClasses } from "@/components/ui/button";
import { Timestamp } from "@/components/ui/timestamp";
import { MarkdownRenderer } from "./markdown-renderer";
import type { RenderedLinks } from "./rendered-links";
import { SharedOutline } from "./shared-outline";

/** Who shared it, when it last changed (a document's page), and when the link stops opening. */
export function SharedByline({ sharedByName, updatedAt, expiresAt }: { sharedByName: string; updatedAt?: Date; expiresAt: Date }) {
  const soon = expiresSoon(expiresAt, new Date());
  // The dots between these are the stylesheet's (`.kh-byline`), so a line never ends on one. A div: the prose spaces every `p`.
  return (
    <div className="kh-byline mt-1.5 text-caption text-kh-text-muted">
      <span>
        <span>{`Shared by ${sharedByName}`}</span>
        {updatedAt ? <span>Updated <Timestamp value={updatedAt} /></span> : null}
        {/* Quiet until it matters: close to the end it is said in the warning colour, with how soon. */}
        <span className={soon ? "font-medium text-kh-warning" : undefined}>Link expires <Timestamp value={expiresAt} variant="date" />{soon ? ` (${soon})` : ""}</span>
      </span>
    </div>
  );
}

/**
 * A shared document's reading column: outline, page icon, title, byline and article — the same on a
 * document link's page and a folder page. `links` is what the page may link (a folder page's
 * in-folder links; a document link's page passes none); anything else reads as its text.
 */
export function SharedReading({ document, links, contentId }: { document: SharedDocumentView; links?: RenderedLinks; contentId?: string }) {
  const outline = extractOutline(document.markdown);
  // Title, then who shared it, then the article — whether the title is this page's or the document's own `#` heading.
  const contentOwnsTitle = markdownOpensWithHeading(document.markdown);
  const byline = <SharedByline sharedByName={document.sharedByName} updatedAt={document.updatedAt} expiresAt={document.expiresAt} />;
  const pageIcon = document.pageIcon ? <div data-shared-page-icon className="mb-2 select-none text-display leading-8" aria-hidden="true">{document.pageIcon}</div> : null;
  return (
    <>
      {/* Outline: a rail off the column's left edge when there is room, else a disclosure above the title (share-page-outline spec §2). */}
      <div className="kh-share-outline"><SharedOutline entries={outline} placement="disclosure" /></div>
      {outline.length > 0 ? <div className="kh-share-outline-rail kh-reading-column sticky top-[4.5rem] z-10 h-0"><div className="kh-outline-hang absolute right-full top-0 w-52"><SharedOutline entries={outline} placement="rail" /></div></div> : null}
      {contentOwnsTitle && pageIcon ? <div className="kh-reading-column pt-6">{pageIcon}</div> : null}
      {contentOwnsTitle ? null : <header className="kh-reading-column pt-6">{pageIcon}<h1 className="text-page-title font-semibold tracking-tight text-kh-text">{document.title}</h1>{byline}</header>}
      {/* The skip link's target is the article itself, so it is still a direct child of the panel's reading column (its comment-marker gutter depends on that). */}
      <article id={contentId} tabIndex={contentId ? -1 : undefined} data-review-document className={`kh-reading-column min-w-0 scroll-mt-14 pb-6 ${contentOwnsTitle ? "pt-6" : "pt-3"} [&>div>:first-child]:mt-0`}>
        <MarkdownRenderer markdown={document.markdown} links={links} unresolvedAsText afterTitle={contentOwnsTitle ? byline : undefined} />
      </article>
    </>
  );
}

/**
 * The first focusable thing on a shared page: past the pinned bar and, on a folder page, the tree,
 * straight to the reading column. Hidden until focused, as a skip link is.
 */
export function SharedSkipLink() {
  return (
    <a href="#shared-content" className="kh-skip-link">Skip to content</a>
  );
}

/** What closes every shared page: the way into the Hub, said once more under the article. */
export function SharedFooter({ platformEntry }: { platformEntry: string }) {
  return (
    <footer className="kh-reading-column pb-10 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-kh-border pt-5">
        <div><p className="text-body font-medium text-kh-text">Keep useful knowledge within reach.</p><p className="mt-1 text-body-sm text-kh-text-muted">Organize documents and search your workspace’s knowledge in Knowledge Hub.</p></div>
        <a href={platformEntry} className={buttonClasses({ variant: "primary" })}>Get started</a>
      </div>
      <p className="mt-3 text-caption text-kh-text-muted">Continue with your company account. Workspace access is managed separately from this share link.</p>
    </footer>
  );
}

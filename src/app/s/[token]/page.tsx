import { SaveShareButton } from "@/components/knowledge/save-share-button";
import { SharedReviewPanel } from "@/components/knowledge/shared-review-panel";
import { buttonClasses } from "@/components/ui/button";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MarkdownRenderer } from "@/components/knowledge/markdown-renderer";
import { SharedOutline } from "@/components/knowledge/shared-outline";
import { extractOutline } from "@/shared/markdown/outline";
import { markdownOpensWithHeading } from "@/lib/markdown-title";
import { Timestamp } from "@/components/ui/timestamp";
import { getSharedDocument } from "@/server/share-read";
import { publicOrigin } from "@/server/config";
import { expiresSoon } from "@/lib/share-expiry";
import { ExternalLink } from "lucide-react";

export const dynamic = "force-dynamic";

type SharedPageProps = { params: Promise<{ token: string }> };

/**
 * A shared document, readable without signing in (share-link spec §6.5).
 * No app shell or tree. Platform entry is an explicit, non-prefetched link.
 * No Open Graph tags,
 * so a chat preview gets the title and nothing of the body (§14).
 */
export async function generateMetadata({ params }: SharedPageProps): Promise<Metadata> {
  const shared = await getSharedDocument((await params).token);
  return {
    title: shared ? shared.title : "Link not available",
    description: null,
    robots: { index: false, follow: false },
  };
}

export default async function SharedDocumentPage({ params }: SharedPageProps) {
  const { token } = await params;
  const shared = await getSharedDocument(token);
  if (!shared) notFound();
  // A full browser navigation to the protected origin lets the company Gateway initiate SSO.
  // The public /s/* routes are exempt from that login challenge.
  const returnTo = `/s/${token}/open`;
  const origin = publicOrigin();
  const outline = extractOutline(shared.markdown);
  const platformEntry = origin ? `${origin}/?${new URLSearchParams({ returnTo })}` : returnTo;
  // Signing in to comment comes back to this page, where the signed-in reader can then comment.
  const signInHref = `${origin ?? ""}/?${new URLSearchParams({ returnTo: `/s/${token}` })}`;
  // Title, then who shared it, then the article — whether the title is this page's or the document's own `#` heading.
  const contentOwnsTitle = markdownOpensWithHeading(shared.markdown);
  const soon = expiresSoon(shared.expiresAt, new Date());
  const pageIcon = shared.pageIcon ? <div data-shared-page-icon className="mb-2 select-none text-display leading-8" aria-hidden="true">{shared.pageIcon}</div> : null;
  // The dots between these are the stylesheet's (`.kh-byline`), so a line never ends on one. A div: the prose spaces every `p`.
  const byline = (
    <div className="kh-byline mt-1.5 text-caption text-kh-text-muted">
      <span>
        <span>{`Shared by ${shared.sharedByName}`}</span>
        <span>Updated <Timestamp value={shared.updatedAt} /></span>
        {/* Quiet until it matters: close to the end it is said in the warning colour, with how soon. */}
        <span className={soon ? "font-medium text-kh-warning" : undefined}>Link expires <Timestamp value={shared.expiresAt} variant="date" />{soon ? ` (${soon})` : ""}</span>
      </span>
    </div>
  );
  return (
    <main className="kh-share-page min-h-screen bg-kh-bg">
      {/* One pinned bar, then the title: the brand, Comments, Save and Open share a row. On a phone Save and Open keep their names for assistive technology and show only their icons. */}
      <SharedReviewPanel token={token} revisionId={shared.revisionId} markdown={shared.markdown} signInHref={signInHref}
        brand={<span className="shrink-0 text-body font-semibold text-kh-text">Knowledge Hub</span>}
        actions={<><SaveShareButton token={token} /><a href={platformEntry} className={buttonClasses({ variant: "ghost" })}><ExternalLink className="size-4 sm:hidden" aria-hidden="true" /><span className="max-sm:sr-only">Open in Knowledge Hub</span></a></>}>
      {/* Outline: a rail off the column's left edge when there is room, else a disclosure above the title (share-page-outline spec §2). */}
      <div className="kh-share-outline"><SharedOutline entries={outline} placement="disclosure" /></div>
      {outline.length > 0 ? <div className="kh-share-outline-rail kh-reading-column sticky top-[4.5rem] z-10 h-0"><div className="absolute right-full top-0 w-52"><SharedOutline entries={outline} placement="rail" /></div></div> : null}
      {contentOwnsTitle && pageIcon ? <div className="kh-reading-column pt-6">{pageIcon}</div> : null}
      {contentOwnsTitle ? null : <header className="kh-reading-column pt-6">{pageIcon}<h1 className="text-page-title font-semibold tracking-tight text-kh-text">{shared.title}</h1>{byline}</header>}
      <article data-review-document className={`kh-reading-column min-w-0 pb-6 ${contentOwnsTitle ? "pt-6" : "pt-3"} [&>div>:first-child]:mt-0`}>
        <MarkdownRenderer markdown={shared.markdown} afterTitle={contentOwnsTitle ? byline : undefined} />
      </article>
      </SharedReviewPanel>
      <footer className="kh-reading-column pb-10 pt-4">
        <p className="text-caption text-kh-text-muted">Shared from Knowledge Hub · <a href={platformEntry} className="kh-focus-ring rounded-md text-kh-link">Open in Knowledge Hub</a></p>
      </footer>
    </main>
  );
}

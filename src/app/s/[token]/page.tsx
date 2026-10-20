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
  return (
    <main className="kh-share-page min-h-screen bg-kh-bg">
      <div className="border-b border-kh-border">
        <div className="kh-share-heading kh-reading-column flex min-h-14 items-center justify-between gap-3 py-2">
          <span className="shrink-0 text-body font-semibold text-kh-text">Knowledge Hub</span>
          <div className="flex min-w-0 flex-wrap items-start justify-end gap-2"><SaveShareButton token={token} /><a href={platformEntry} className={buttonClasses({ variant: "ghost" })}>Open in Knowledge Hub</a></div>
        </div>
      </div>
      <header>
        <div className="kh-share-heading kh-reading-column pb-3 pt-5">
          {!markdownOpensWithHeading(shared.markdown) ? <h1 className="text-heading font-semibold tracking-tight text-kh-text">{shared.title}</h1> : null}
          {/* The dots between these are the stylesheet's (`.kh-byline`), so a line never ends on one. */}
          <p className="kh-byline mt-1.5 text-caption text-kh-text-muted">
            <span>
              <span>{`Shared by ${shared.sharedByName}`}</span>
              <span>Updated <Timestamp value={shared.updatedAt} /></span>
              <span>Link expires <Timestamp value={shared.expiresAt} variant="date" /></span>
            </span>
          </p>
        </div>
      </header>
      {/* Outline: a rail off the column's left edge when there is room, else above the comments bar (share-page-outline spec §2). */}
      <div className="kh-share-outline"><SharedOutline entries={outline} placement="disclosure" /></div>
      <SharedReviewPanel token={token} revisionId={shared.revisionId} markdown={shared.markdown} signInHref={platformEntry}>
      {outline.length > 0 ? <div className="kh-share-outline-rail kh-reading-column sticky top-16 z-10 h-0"><div className="absolute right-full top-0 w-52"><SharedOutline entries={outline} placement="rail" /></div></div> : null}
      <article data-review-document className="kh-reading-column min-w-0 pb-6 pt-6 [&>div>:first-child]:mt-0">
        <MarkdownRenderer markdown={shared.markdown} />
      </article>
      </SharedReviewPanel>
      <footer className="kh-reading-column pb-10 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-kh-border pt-5">
          <div><p className="text-body font-medium text-kh-text">Keep useful knowledge within reach.</p><p className="mt-1 text-body-sm text-kh-text-muted">Organize documents and search your team’s knowledge in Knowledge Hub.</p></div>
          <a href={platformEntry} className={buttonClasses({ variant: "primary" })}>Get started</a>
        </div>
        <p className="mt-3 text-caption text-kh-text-muted">Continue with your company account. Workspace access is managed separately from this share link.</p>
      </footer>
    </main>
  );
}

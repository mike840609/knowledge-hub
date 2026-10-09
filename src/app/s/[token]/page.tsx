import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MarkdownRenderer } from "@/components/knowledge/markdown-renderer";
import { markdownOpensWithHeading } from "@/lib/markdown-title";
import { Timestamp } from "@/components/ui/timestamp";
import { getSharedDocument } from "@/server/share-read";

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
  return (
    <main className="min-h-screen bg-kh-bg">
      <div className="border-b border-kh-border">
        <div className="kh-reading-column flex min-h-14 items-center justify-between gap-3 py-2">
          <span className="text-body font-semibold text-kh-text">Knowledge Hub</span>
          <Link prefetch={false} href={`/s/${token}/open`} className={buttonClasses({ variant: "ghost" })}>Open in Knowledge Hub</Link>
        </div>
      </div>
      <header>
        <div className="kh-reading-column pb-3 pt-5">
          {!markdownOpensWithHeading(shared.markdown) ? <h1 className="text-heading font-semibold tracking-tight text-kh-text">{shared.title}</h1> : null}
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-kh-text-muted">
            <span>{`Shared by ${shared.sharedByName}`}</span>
            <span aria-hidden="true">·</span>
            <span>Updated <Timestamp value={shared.updatedAt} /></span>
            <span aria-hidden="true">·</span>
            <span>Link expires <Timestamp value={shared.expiresAt} variant="date" /></span>
          </p>
        </div>
      </header>
      <article className="kh-reading-column min-w-0 pb-6 pt-6 [&>div>:first-child]:mt-0">
        <MarkdownRenderer markdown={shared.markdown} />
      </article>
      <footer className="kh-reading-column pb-10 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-kh-border pt-5">
          <div><p className="text-body font-medium text-kh-text">Keep useful knowledge within reach.</p><p className="mt-1 text-body-sm text-kh-text-muted">Organize documents and search your team’s knowledge in Knowledge Hub.</p></div>
          <Link prefetch={false} href={`/s/${token}/open`} className={buttonClasses({ variant: "primary" })}>Get started</Link>
        </div>
        <p className="mt-3 text-caption text-kh-text-muted">Continue with your company account. Workspace access is managed separately from this share link.</p>
      </footer>
    </main>
  );
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MarkdownRenderer } from "@/components/knowledge/markdown-renderer";
import { Timestamp } from "@/components/ui/timestamp";
import { getSharedDocument } from "@/server/share-read";

export const dynamic = "force-dynamic";

type SharedPageProps = { params: Promise<{ token: string }> };

/**
 * A shared document, readable without signing in (share-link spec §6.5).
 * No app shell, tree or link into the Hub: most readers have no account, and
 * a link to `/` would only send them to a sign-in page. No Open Graph tags,
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
  const shared = await getSharedDocument((await params).token);
  if (!shared) notFound();
  return (
    <main className="min-h-screen bg-kh-bg">
      <header className="bg-kh-bg-raised">
        <div className="kh-reading-column pb-3 pt-5">
          <h1 className="text-heading font-semibold tracking-tight text-kh-text">{shared.title}</h1>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-kh-text-muted">
            <span>Shared by {shared.sharedByName}</span>
            <span aria-hidden="true">·</span>
            <span>Updated <Timestamp value={shared.updatedAt} /></span>
            <span aria-hidden="true">·</span>
            <span>Link expires <Timestamp value={shared.expiresAt} variant="date" /></span>
          </p>
        </div>
      </header>
      <article className="kh-reading-column min-w-0 pb-12 pt-6 [&>div>:first-child]:mt-0">
        <MarkdownRenderer markdown={shared.markdown} />
      </article>
    </main>
  );
}

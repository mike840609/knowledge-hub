import { SaveShareButton } from "@/components/knowledge/save-share-button";
import { SharedReviewPanel } from "@/components/knowledge/shared-review-panel";
import { SharedFooter, SharedReading, SharedSkipLink, SHARED_CONTENT_ID } from "@/components/knowledge/shared-reading";
import { buttonClasses } from "@/components/ui/button";
import type { Metadata } from "next";
import type { SharedView } from "@/modules/knowledge/application/document-share-service";
import { notFound } from "next/navigation";
import { sharedDocumentParam } from "@/lib/share-paths";
import { getShared } from "@/server/share-read";
import { publicOrigin } from "@/server/config";
import { ExternalLink } from "lucide-react";
import { SharedFolderPage } from "./shared-folder-page";

export const dynamic = "force-dynamic";

type SharedPageProps = { params: Promise<{ token: string }>; searchParams?: Promise<{ d?: string | string[] }> };

/**
 * The link and, on a folder page, the document `?d=` names. A malformed `?d=` reads nothing and is
 * not available; a well-formed one is navigation the service judges (folder share spec §4).
 */
async function readPage({ params, searchParams }: SharedPageProps): Promise<{ token: string; shared: SharedView | null }> {
  const { token } = await params;
  const documentId = sharedDocumentParam((await searchParams)?.d);
  return { token, shared: documentId === null ? null : await getShared(token, documentId) };
}

/**
 * A shared document or folder, readable without signing in (share-link spec §6.5).
 * No app shell. Platform entry is an explicit, non-prefetched link.
 * No Open Graph tags,
 * so a chat preview gets the title and nothing of the body (§14).
 */
export async function generateMetadata(props: SharedPageProps): Promise<Metadata> {
  const { shared } = await readPage(props);
  return {
    title: shared ? sharedTitle(shared) : "Link not available",
    description: null,
    robots: { index: false, follow: false },
  };
}

/** The document being read, else the folder's name (folder share spec §4). */
function sharedTitle(shared: SharedView): string {
  if (shared.kind === "DOCUMENT") return shared.title;
  return shared.document ? shared.document.title : shared.folderName;
}

/** The query a Hub entry carries back to the page read. */
const returnToQuery = (returnTo: string) => new URLSearchParams({ returnTo }).toString();

/** The Hub entry for a full browser navigation, continuing to `returnTo` once signed in; null without a public origin. */
function hubEntry(returnTo: string): string | null {
  const origin = publicOrigin();
  return origin ? `${origin}/?${returnToQuery(returnTo)}` : null;
}

/** Signing in to comment comes back to the page read, where the signed-in reader can then comment. */
function signInHref(returnTo: string): string {
  return hubEntry(returnTo) ?? `/?${returnToQuery(returnTo)}`;
}

/** The Hub's front door, by a full browser navigation, continuing to `returnTo` once signed in. */
function platformEntry(returnTo: string): string {
  return hubEntry(returnTo) ?? returnTo;
}

export default async function SharedPage(props: SharedPageProps) {
  const { token, shared } = await readPage(props);
  if (!shared) notFound();
  if (shared.kind === "FOLDER") {
    const documentId = shared.document?.documentId;
    const named = documentId ? `?d=${documentId}` : "";
    return <SharedFolderPage token={token} folder={shared} platformEntry={platformEntry(`/s/${token}/open${named}`)} signInHref={signInHref(`/s/${token}${named}`)} />;
  }
  // A full browser navigation to the protected origin lets the company Gateway initiate SSO.
  // The public /s/* routes are exempt from that login challenge.
  const entry = platformEntry(`/s/${token}/open`);
  return (
    <main className="kh-share-page min-h-screen bg-kh-bg">
      <SharedSkipLink />
      {/* One pinned bar, then the title: the brand, Comments, Save and Open share a row. Save and Open show one word each (their full names stay for assistive technology), and on a phone only their icons. */}
      <SharedReviewPanel token={token} revisionId={shared.revisionId} markdown={shared.markdown} signInHref={signInHref(`/s/${token}`)}
        brand={<span className="shrink-0 text-body font-semibold text-kh-text">Knowledge Hub</span>}
        actions={<><SaveShareButton token={token} /><span aria-hidden="true" className="mx-1 h-4 w-px bg-kh-border max-sm:hidden" /><a href={entry} className={buttonClasses({ variant: "ghost" })}><ExternalLink className="size-4" aria-hidden="true" /><span className="max-sm:sr-only">Open<span className="sr-only"> in Knowledge Hub</span></span></a></>}>
        <SharedReading document={shared} contentId={SHARED_CONTENT_ID} />
      </SharedReviewPanel>
      <SharedFooter platformEntry={entry} />
    </main>
  );
}

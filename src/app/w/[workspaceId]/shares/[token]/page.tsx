import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { SharedReviewPanel } from "@/components/knowledge/shared-review-panel";
import { SharedReading, SharedSkipLink, SHARED_CONTENT_ID } from "@/components/knowledge/shared-reading";
import { hubSharePath, sharedDocumentParam } from "@/lib/share-paths";
import type { SharedView } from "@/modules/knowledge/application/document-share-service";
import { SHARED_PREFIX } from "@/modules/knowledge/domain/share-comment-event";
import { applicationServices } from "@/server/composition";
import { getSharedForViewer } from "@/server/share-read";
import { SharedFolderPage } from "@/app/s/[token]/shared-folder-page";

export const dynamic = "force-dynamic";

type HubSharePageProps = { params: Promise<{ workspaceId: string; token: string }>; searchParams?: Promise<Record<string, string | string[] | undefined>> };

type HubShareRead = { token: string; ownPath: string | null; pagePath: string; shared: SharedView | null };

/**
 * The signed-in reader and the share as they may read it. The page and its metadata both call this,
 * and both of its steps are cached per request, so a visit counts one view and the title is never
 * shown where the body would not open. Another person's Workspace id in the path reads nothing:
 * `ownPath` is where the page sends the reader instead.
 */
async function readPage({ params, searchParams }: HubSharePageProps): Promise<HubShareRead> {
  const { workspaceId, token } = await params;
  const query = (await searchParams) ?? {};
  const documentId = sharedDocumentParam(query.d);
  const { caller, personalWorkspace } = await applicationServices().establishTrustedCaller();
  const pagePath = hubSharePath(personalWorkspace.id, token);
  if (workspaceId !== personalWorkspace.id) {
    // The whole query goes along: `?d=` and `?thread=` are where the reader was sent.
    const search = new URLSearchParams(Object.entries(query).flatMap(([key, value]) => [value ?? []].flat().map(item => [key, item]))).toString();
    return { token, pagePath, ownPath: search ? `${pagePath}?${search}` : pagePath, shared: null };
  }
  const shared = documentId === null ? null : await getSharedForViewer(token, caller.identity.id, documentId);
  return { token, pagePath, ownPath: null, shared };
}

export async function generateMetadata(props: HubSharePageProps): Promise<Metadata> {
  const { shared } = await readPage(props);
  return { title: shared ? sharedTitle(shared) : "Link not available", robots: { index: false, follow: false } };
}

/** The document being read, else the shared root's name, as `/s/<token>` titles it. */
function sharedTitle(shared: SharedView): string {
  if (shared.kind === "DOCUMENT") return shared.title;
  return shared.document ? shared.document.title : shared.rootName;
}

/**
 * The Hub's reader of a share (named-recipient share spec, "Where a NAMED share is read"). The company
 * Gateway sends no identity to `/s/<token>`, so a named share is read here, inside the caller's own
 * personal Workspace shell, by its recipients and its owner. It draws what `/s/<token>` draws, less
 * what a signed-in reader has no use for: no Save, no Open in the Hub, no sign-in prompt. The path's
 * Workspace is only whose shell to draw; it grants nothing, and the read is judged as `/s/<token>`'s is.
 */
export default async function HubSharePage(props: HubSharePageProps) {
  const { token, ownPath, pagePath, shared } = await readPage(props);
  if (ownPath) redirect(ownPath);
  if (!shared) notFound();
  if (shared.linkId) await markRead(shared.linkId);
  // A Source link renders the tree page too, but not until Task 4 (source share spec §4).
  if (shared.kind === "SOURCE") notFound();
  if (shared.kind === "FOLDER") {
    const documentId = shared.document?.documentId;
    return <SharedFolderPage token={token} folder={shared} platformEntry={null} pagePath={pagePath} signInHref={documentId ? `${pagePath}?d=${documentId}` : pagePath} />;
  }
  return (
    <div className="kh-share-page min-h-full bg-kh-bg">
      <SharedSkipLink />
      <SharedReviewPanel token={token} revisionId={shared.revisionId} markdown={shared.markdown} signInHref={pagePath}>
        <SharedReading document={shared} contentId={SHARED_CONTENT_ID} />
      </SharedReviewPanel>
    </div>
  );
}

/** Reading a named share clears its Inbox entry. Only the caller's own recipient row changes; the owner has none. */
async function markRead(linkId: string): Promise<void> {
  const services = applicationServices();
  const { caller } = await services.establishTrustedCaller();
  try {
    await services.reviews.markEventRead(caller, `${SHARED_PREFIX}${linkId}`);
  } catch {
    // An unread entry left behind must not stop the reader, as an uncounted view does not.
    console.warn("Named share was not marked read.");
  }
}

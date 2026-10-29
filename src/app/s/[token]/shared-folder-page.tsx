import { ExternalLink } from "lucide-react";
import type { SharedFolderView } from "@/modules/knowledge/application/document-share-service";
import { SaveShareButton } from "@/components/knowledge/save-share-button";
import { SharedReviewPanel } from "@/components/knowledge/shared-review-panel";
import { sharedFolderLinks } from "@/components/knowledge/shared-folder-links";
import { SharedFolderTree, SharedFolderTreeButton, SharedFolderTreeScope } from "@/components/knowledge/shared-folder-tree";
import { SharedByline, SharedFooter, SharedReading, SharedSkipLink } from "@/components/knowledge/shared-reading";
import { buttonClasses } from "@/components/ui/button";

/**
 * A folder link's page (folder share spec §4): the pinned bar (brand, where the document sits,
 * Comments, Save, Open), the folder's tree beside the reading column, and the document link's
 * reading column itself. Its links are only those the caller-less read kept, the ones that land
 * inside the folder (§5); every other link reads as its text.
 *
 * Comments are the document's being read, through this link (§6): the panel names it on every
 * request, and is drawn afresh for each document so nothing one document held carries to the next.
 * The tree is not: it stands outside the panel, so the folders a reader opened and where they
 * scrolled it stay as they move; only its phone button sits in the panel's bar.
 * Save keeps the folder link, as one entry. Open takes the document being read into the Hub, where
 * ordinary access decides what opens.
 */
export function SharedFolderPage({ token, folder, platformEntry, signInHref }: { token: string; folder: SharedFolderView; platformEntry: string; signInHref: string }) {
  const { document } = folder;
  const crumbs = document ? [folder.folderName, ...document.path.map((ancestor) => ancestor.name), document.title] : [folder.folderName];
  const tree = <SharedFolderTree token={token} nodes={folder.tree} currentDocumentId={document?.documentId ?? null} folderName={folder.folderName} />;
  const lead = (
    <>
      <SharedFolderTreeButton />
      <span className="shrink-0 text-body font-semibold text-kh-text">Knowledge Hub</span>
      <span aria-hidden="true" className="text-body text-kh-text-muted max-sm:hidden">/</span>
      <nav aria-label="Breadcrumb" className="min-w-0 flex-1 max-sm:hidden">
        <ol className="flex min-w-0 items-center gap-2 text-body text-kh-text-muted">
          {crumbs.map((name, index) => {
            const last = index === crumbs.length - 1;
            return [
              index > 0 ? <li key={`${index}-separator`} aria-hidden="true">/</li> : null,
              <li key={index} aria-current={last ? "location" : undefined} title={name} className={`min-w-0 truncate ${last ? "font-medium text-kh-text" : ""}`}>{name}</li>,
            ];
          })}
        </ol>
      </nav>
    </>
  );
  const actions = (
    <>
      <SaveShareButton token={token} />
      <span aria-hidden="true" className="mx-1 h-4 w-px bg-kh-border max-sm:hidden" />
      <a href={platformEntry} className={buttonClasses({ variant: "ghost" })}><ExternalLink className="size-4" aria-hidden="true" /><span className="max-sm:sr-only">Open<span className="sr-only"> in Knowledge Hub</span></span></a>
    </>
  );
  if (!document) {
    return (
      <main className="kh-share-page kh-share-folder min-h-screen bg-kh-bg">
        <SharedSkipLink />
        <SharedFolderTreeScope>
          <div className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-kh-border bg-kh-bg px-4">
            {lead}
            {/* -me-3 takes back the last button's padding, so its label ends on the bar's edge. */}
            <div className="-me-3 ml-auto flex shrink-0 items-center gap-1">{actions}</div>
          </div>
          {tree}
        </SharedFolderTreeScope>
        <div className="kh-share-folder-body">
          <div id="shared-content" tabIndex={-1} className="kh-reading-column py-6">
            <h1 className="text-page-title font-semibold tracking-tight text-kh-text">{folder.folderName}</h1>
            <SharedByline sharedByName={folder.sharedByName} expiresAt={folder.expiresAt} />
            <p className="mt-6 text-body text-kh-text-muted">This folder has no documents yet.</p>
          </div>
          <SharedFooter platformEntry={platformEntry} />
        </div>
      </main>
    );
  }
  return (
    <main className="kh-share-page kh-share-folder min-h-screen bg-kh-bg">
      <SharedSkipLink />
      {/* The bar is the panel's, inside the body beside the tree; it reaches back over the tree's column (globals.css). */}
      <SharedFolderTreeScope>
        {/* Before the panel, as it was the bar's first part: the rail still comes first in focus order. */}
        {tree}
        <div className="kh-share-folder-body">
          <SharedReviewPanel key={document.documentId} token={token} documentId={document.documentId} revisionId={document.revisionId} markdown={document.markdown} signInHref={signInHref} brand={lead} actions={actions} wide>
            <div id="shared-content" tabIndex={-1}><SharedReading document={document} links={sharedFolderLinks(token, document.links)} /></div>
          </SharedReviewPanel>
          <SharedFooter platformEntry={platformEntry} />
        </div>
      </SharedFolderTreeScope>
    </main>
  );
}

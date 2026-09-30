"use client";

import Link from "next/link";
import type { DocumentLinkView, OutgoingLinkView } from "@/modules/knowledge/application/knowledge-link-service";
import { GraphCanvas } from "./graph-canvas";
import type { GraphViewData } from "./graph-model";
import { documentPath } from "./rendered-links";
import { LinkIndexNote } from "./link-index-note";

export type LocalGraphData = {
  data: GraphViewData;
  depth: 1 | 2;
  openHref: string;
  depthHrefs: { 1: string; 2: string };
};

/**
 * The document and what it is one or two links from, small enough to sit in
 * the inspector. Not pannable or zoomable — that is what the full graph is
 * for, one click away — but every node is a link, and the table under it (the
 * sections below) lists the same documents in words.
 */
function LocalGraph({ graph, focusId }: { graph: LocalGraphData; focusId: string }) {
  const connected = graph.data.nodes.length > 1;
  return (
    <section aria-label="Local graph" data-links-section="graph">
      <div className="flex items-baseline justify-between">
        <h3 className="text-caption font-medium text-kh-text-muted">Graph</h3>
        <div className="flex items-center gap-2 text-caption">
          {([1, 2] as const).map((depth) => (
            <Link
              key={depth}
              href={graph.depthHrefs[depth]}
              replace
              scroll={false}
              // These point at the page they are on. Prefetched from itself, the
              // server answers with the whole page and Next applies it on first
              // use — racing the click, and sometimes losing the navigation
              // (keyboard-shortcuts spec §9 has the mechanism, and the tree the
              // same fix).
              prefetch={false}
              aria-current={graph.depth === depth ? "true" : undefined}
              className={`rounded-md px-1 kh-focus-ring ${graph.depth === depth ? "font-medium text-kh-text" : "text-kh-text-muted hover:text-kh-text"}`}
            >
              {depth === 1 ? "1 link" : "2 links"}
            </Link>
          ))}
        </div>
      </div>
      {connected ? (
        <div className="mt-1 h-56 overflow-hidden rounded-md border border-kh-border bg-kh-bg">
          <GraphCanvas
            data={graph.data}
            focusId={focusId}
            interactive={false}
            ariaLabel={`Local graph, ${graph.data.nodes.length} documents`}
          />
        </div>
      ) : (
        <p className="mt-1 px-2 text-body-sm text-kh-text-muted">Nothing is linked to or from this document yet.</p>
      )}
      <Link href={graph.openHref} className="mt-1 inline-block rounded-md px-1 text-caption text-kh-link underline underline-offset-2 kh-focus-ring">
        Open in graph
      </Link>
    </section>
  );
}

function SectionHeading({ children, count }: { children: string; count: number }) {
  return (
    <h3 className="flex items-baseline justify-between text-caption font-medium text-kh-text-muted">
      <span>{children}</span>
      <span>{count}</span>
    </h3>
  );
}

function OutgoingRow({ workspaceId, link, createHref }: { workspaceId: string; link: OutgoingLinkView; createHref?: string }) {
  if (link.resolution.status === "UNRESOLVED") {
    return (
      <li className="flex items-baseline justify-between gap-2 px-2 py-1.5 text-body-sm text-kh-text-secondary">
        <span data-unresolved-link title={`No document matches “${link.target}”`} className="min-w-0 cursor-help truncate border-b border-dashed border-kh-text-muted">
          {link.display ?? link.target}
        </span>
        {createHref ? (
          <Link
            href={createHref}
            prefetch={false}
            data-create-link
            aria-label={`Create a document for “${link.target}”`}
            className="shrink-0 rounded-md px-1 text-caption text-kh-link underline underline-offset-2 kh-focus-ring"
          >
            Create
          </Link>
        ) : null}
      </li>
    );
  }
  return (
    <li>
      <Link
        href={documentPath(workspaceId, link.resolution.sourceId, link.resolution.documentId)}
        className="block truncate rounded-md px-2 py-1.5 text-body-sm text-kh-text hover:bg-kh-bg-hover kh-focus-ring"
      >
        {link.resolution.title}
      </Link>
    </li>
  );
}

/**
 * The inspector's Links tab: what links here, what this links to, and what it
 * tries to link to that is not there. Everything comes from the same view that
 * resolved the links in the content, so the two cannot disagree.
 */
export function DocumentLinksPanel({
  view,
  localGraph,
  focusId,
  createLinks = {},
}: {
  view: DocumentLinkView | null;
  localGraph: LocalGraphData | null;
  focusId: string;
  /** Where to make the document an unresolved link names, by the link's `lookupKey`; empty for someone who cannot write. */
  createLinks?: Readonly<Record<string, string>>;
}) {
  if (!view) {
    return <p className="text-body-sm text-kh-text-muted">Links are not available right now.</p>;
  }
  const resolved = view.outgoing.filter((link) => link.resolution.status === "RESOLVED");
  return (
    <div className="space-y-4">
      <LinkIndexNote stale={view.index.stale} />
      {localGraph ? <LocalGraph graph={localGraph} focusId={focusId} /> : null}
      <section aria-label="Backlinks" data-links-section="backlinks">
        <SectionHeading count={view.backlinkTotal}>Backlinks</SectionHeading>
        {view.backlinks.length === 0 ? (
          <p className="mt-1 px-2 text-body-sm text-kh-text-muted">No document links here yet.</p>
        ) : (
          <ul className="mt-1 space-y-0.5">
            {view.backlinks.map((backlink) => (
              <li key={backlink.documentId}>
                <Link
                  href={documentPath(view.workspaceId, backlink.sourceId, backlink.documentId)}
                  className="block rounded-md px-2 py-1.5 hover:bg-kh-bg-hover kh-focus-ring"
                >
                  <span className="block truncate text-body-sm font-medium text-kh-text">{backlink.title}</span>
                  {backlink.context ? <span className="mt-0.5 block truncate text-caption text-kh-text-muted">{backlink.context}</span> : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-label="Outgoing links" data-links-section="outgoing">
        <SectionHeading count={resolved.length}>Outgoing links</SectionHeading>
        {resolved.length === 0 ? (
          <p className="mt-1 px-2 text-body-sm text-kh-text-muted">This document does not link to another one.</p>
        ) : (
          <ul className="mt-1 space-y-0.5">
            {resolved.map((link) => (
              <OutgoingRow key={link.lookupKey} workspaceId={view.workspaceId} link={link} />
            ))}
          </ul>
        )}
      </section>
      {view.unresolved.length > 0 ? (
        <section aria-label="Unresolved links" data-links-section="unresolved">
          <SectionHeading count={view.unresolved.length}>Unresolved</SectionHeading>
          <ul className="mt-1 space-y-0.5">
            {view.unresolved.map((link) => (
              <OutgoingRow key={link.lookupKey} workspaceId={view.workspaceId} link={link} createHref={createLinks[link.lookupKey]} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

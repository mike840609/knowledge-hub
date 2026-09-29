"use client";

import Link from "next/link";
import type { DocumentLinkView, OutgoingLinkView } from "@/modules/knowledge/application/knowledge-link-service";
import { documentPath } from "./rendered-links";
import { LinkIndexNote } from "./link-index-note";

function SectionHeading({ children, count }: { children: string; count: number }) {
  return (
    <h3 className="flex items-baseline justify-between text-caption font-medium text-kh-text-muted">
      <span>{children}</span>
      <span>{count}</span>
    </h3>
  );
}

function OutgoingRow({ workspaceId, link }: { workspaceId: string; link: OutgoingLinkView }) {
  if (link.resolution.status === "UNRESOLVED") {
    return (
      <li className="px-2 py-1.5 text-body-sm text-kh-text-secondary">
        <span data-unresolved-link title={`No document matches “${link.target}”`} className="cursor-help border-b border-dashed border-kh-text-muted">
          {link.display ?? link.target}
        </span>
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
export function DocumentLinksPanel({ view }: { view: DocumentLinkView | null }) {
  if (!view) {
    return <p className="text-body-sm text-kh-text-muted">Links are not available right now.</p>;
  }
  const resolved = view.outgoing.filter((link) => link.resolution.status === "RESOLVED");
  return (
    <div className="space-y-4">
      <LinkIndexNote stale={view.index.stale} />
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
              <OutgoingRow key={link.lookupKey} workspaceId={view.workspaceId} link={link} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

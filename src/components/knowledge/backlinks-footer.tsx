import Link from "next/link";
import type { DocumentLinkView } from "@/modules/knowledge/application/knowledge-link-service";
import { documentPath } from "./rendered-links";
import { LinkIndexNote } from "./link-index-note";

/**
 * "Linked from": the documents that link to this one, under the content, where
 * a reader who has just finished it is looking. Nothing at all when there are
 * none and the index is whole — an empty heading would say less than silence.
 */
export function BacklinksFooter({ view }: { view: DocumentLinkView }) {
  if (view.backlinks.length === 0 && view.index.stale === 0) return null;
  const hidden = view.backlinkTotal - view.backlinks.length;
  return (
    <section aria-labelledby="linked-from-heading" data-backlinks className="mt-8 border-t border-kh-border pt-4">
      {view.backlinks.length > 0 ? (
        <>
          <h2 id="linked-from-heading" className="text-body font-semibold text-kh-text">
            Linked from {view.backlinkTotal} {view.backlinkTotal === 1 ? "document" : "documents"}
          </h2>
          <ul className="mt-2 space-y-0.5">
            {view.backlinks.map((backlink) => (
              <li key={backlink.documentId}>
                <Link
                  href={documentPath(view.workspaceId, backlink.sourceId, backlink.documentId)}
                  className="block rounded-md px-2 py-2 hover:bg-kh-bg-hover kh-focus-ring"
                >
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="truncate text-body font-medium text-kh-text">{backlink.title}</span>
                    <span className="shrink-0 text-caption text-kh-text-muted">{backlink.sourceName}</span>
                    {backlink.count > 1 ? <span className="shrink-0 text-caption text-kh-text-muted">×{backlink.count}</span> : null}
                  </span>
                  {backlink.context ? <span className="mt-0.5 block truncate text-body-sm text-kh-text-muted">{backlink.context}</span> : null}
                </Link>
              </li>
            ))}
          </ul>
          {hidden > 0 ? <p className="mt-2 px-2 text-caption text-kh-text-muted">and {hidden} more</p> : null}
        </>
      ) : (
        <h2 id="linked-from-heading" className="sr-only">Linked from</h2>
      )}
      <div className="mt-2">
        <LinkIndexNote stale={view.index.stale} />
      </div>
    </section>
  );
}

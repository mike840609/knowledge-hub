import Link from "next/link";
import { FileText } from "lucide-react";
import { highlightSnippet } from "@/modules/knowledge/domain/search-query";
import { plainSearchSnippet } from "@/lib/search-snippet";
import type { KnowledgeSearchRow } from "@/modules/knowledge/ports/knowledge-search-repository";
import { formatDate, formatDateTime } from "@/lib/format-date";

function asDate(value: Date): Date {
  return value instanceof Date ? value : new Date(value);
}

function Highlighted({ text, terms }: { text: string; terms: readonly string[] }) {
  return (
    <>
      {highlightSnippet(text, terms).map((segment, index) =>
        segment.match
          ? <mark key={index} className="rounded-sm bg-kh-highlight text-kh-text">{segment.text}</mark>
          : <span key={index}>{segment.text}</span>,
      )}
    </>
  );
}

export function SearchResultRow({
  hit, terms, includeArchived, showWorkspace,
}: {
  hit: KnowledgeSearchRow;
  terms: readonly string[];
  includeArchived: boolean;
  /** Only when results can span workspaces; otherwise the column is noise. */
  showWorkspace: boolean;
}) {
  const href = `/w/${hit.workspaceId}/knowledge/${hit.sourceId}/${hit.documentId}${includeArchived ? "?includeArchived=true" : ""}`;
  const snippet = plainSearchSnippet(hit.snippet);
  const updatedAt = asDate(hit.updatedAt);
  return (
    <li>
      {/* Metadata is one group that changes layout rather than two that hide
          each other: `hidden` drops content from the accessibility tree, so a
          narrow-viewport reader would lose the source and date entirely.
          Below sm it wraps under the title; from sm it becomes aligned
          right-hand columns a reader can scan straight down. */}
      <Link href={href} data-search-result className="kh-interactive-row flex items-start gap-3 px-3 py-2.5">
        <FileText size={16} strokeWidth={2} aria-hidden="true" className="mt-0.5 shrink-0 text-kh-text-muted" />
        <span className="min-w-0 flex-1 sm:flex sm:items-start sm:gap-3">
          <span className="block min-w-0 sm:flex-1">
            <span className="block truncate text-body font-medium text-kh-text">
              <Highlighted text={hit.title} terms={terms} />
            </span>
            {snippet && (
              <span className="mt-0.5 block line-clamp-2 text-body-sm text-kh-text-secondary">
                <Highlighted text={snippet} terms={terms} />
              </span>
            )}
          </span>
          <span className="mt-1.5 flex flex-wrap items-center gap-2 text-caption text-kh-text-muted sm:mt-0 sm:shrink-0 sm:flex-nowrap sm:justify-end">
            {showWorkspace && (
              <span className="max-w-[9rem] truncate">{hit.workspaceName}</span>
            )}
            <span className="max-w-[10rem] truncate rounded-md border border-kh-border px-1.5 py-0.5">
              {hit.sourceName}
            </span>
            <time
              dateTime={updatedAt.toISOString()}
              title={formatDateTime(updatedAt)}
              className="sm:w-[7.5rem] sm:text-right"
            >
              {formatDate(updatedAt)}
            </time>
          </span>
        </span>
      </Link>
    </li>
  );
}

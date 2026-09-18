import Link from "next/link";
import { FileText } from "lucide-react";
import { highlightSnippet } from "@/modules/knowledge/domain/search-query";
import type { KnowledgeSearchRow } from "@/modules/knowledge/ports/knowledge-search-repository";

function formatTimestamp(value: Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleString();
}

export function SearchResultRow({
  hit, terms, includeArchived,
}: {
  hit: KnowledgeSearchRow;
  terms: readonly string[];
  includeArchived: boolean;
}) {
  const href = `/w/${hit.workspaceId}/knowledge/${hit.sourceId}/${hit.documentId}${includeArchived ? "?includeArchived=true" : ""}`;
  return (
    <li>
      <Link
        href={href}
        className="flex gap-3 rounded-md border border-kh-border bg-kh-bg px-3 py-2.5 transition hover:bg-kh-bg-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-kh-focus"
      >
        <FileText size={16} strokeWidth={2} aria-hidden="true" className="mt-0.5 shrink-0 text-kh-text-muted" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-kh-text">{hit.title}</span>
          <span className="mt-0.5 block truncate text-xs text-kh-text-muted">
            {hit.workspaceName} · {hit.sourceName} · <time dateTime={new Date(hit.updatedAt).toISOString()}>{formatTimestamp(hit.updatedAt)}</time>
          </span>
          <span className="mt-1 block text-sm text-kh-text-muted line-clamp-2">
            {highlightSnippet(hit.snippet, terms).map((segment, index) =>
              segment.match
                ? <mark key={index} className="bg-kh-highlight text-kh-text">{segment.text}</mark>
                : <span key={index}>{segment.text}</span>,
            )}
          </span>
        </span>
      </Link>
    </li>
  );
}

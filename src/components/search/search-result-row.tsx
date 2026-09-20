import Link from "next/link";
import { FileText } from "lucide-react";
import { highlightSnippet } from "@/modules/knowledge/domain/search-query";
import { plainSearchSnippet } from "@/lib/search-snippet";
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
  const snippet = plainSearchSnippet(hit.snippet);
  return (
    <li>
      <Link
        href={href}
        className="kh-interactive-row flex gap-3 px-3 py-3"
      >
        <FileText size={16} strokeWidth={2} aria-hidden="true" className="mt-0.5 shrink-0 text-kh-text-muted" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body font-medium text-kh-text">
            {highlightSnippet(hit.title, terms).map((segment, index) =>
              segment.match
                ? <mark key={index} className="rounded-sm bg-kh-highlight text-kh-text">{segment.text}</mark>
                : <span key={index}>{segment.text}</span>,
            )}
          </span>
          {snippet && <span className="mt-1 block line-clamp-2 text-body leading-5 text-kh-text-muted">
            {highlightSnippet(snippet, terms).map((segment, index) =>
              segment.match
                ? <mark key={index} className="rounded-sm bg-kh-highlight text-kh-text">{segment.text}</mark>
                : <span key={index}>{segment.text}</span>,
            )}
          </span>}
          <span className="mt-1 block truncate text-caption text-kh-text-muted">
            {hit.workspaceName} · {hit.sourceName} · <time dateTime={new Date(hit.updatedAt).toISOString()}>{formatTimestamp(hit.updatedAt)}</time>
          </span>
        </span>
      </Link>
    </li>
  );
}

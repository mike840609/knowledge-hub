import Link from "next/link";
import type { SearchPageModel } from "@/server/search-read";
import { SearchResultRow } from "@/components/search/search-result-row";

function pageHref(model: SearchPageModel, page: number): string {
  const params = new URLSearchParams({ q: model.q, scope: model.scope });
  if (model.scope === "workspace" && model.sourceId) params.set("source", model.sourceId);
  if (model.includeArchived) params.set("archived", "1");
  if (page > 1) params.set("page", String(page));
  return `/w/${model.workspaceId}/search?${params.toString()}`;
}

export function SearchResults({ model }: { model: SearchPageModel }) {
  if (model.timedOut) {
    return (
      <p role="alert" className="rounded-md border border-kh-border p-6 text-sm text-kh-danger">
        搜尋逾時，請縮小範圍後再試一次。
      </p>
    );
  }
  const result = model.result;
  if (result === null) {
    return <p className="rounded-md border border-dashed border-kh-border p-6 text-sm text-kh-text-muted">Enter a keyword to search.</p>;
  }
  if (result.tooLong) {
    return <p role="alert" className="rounded-md border border-kh-border p-6 text-sm text-kh-danger">Query is too long; use at most 200 characters.</p>;
  }
  if (result.hits.length === 0) {
    return <p className="rounded-md border border-dashed border-kh-border p-6 text-sm text-kh-text-muted">No results for this query.</p>;
  }
  return (
    <>
      <ul className="flex flex-col gap-2">
        {result.hits.map((hit) => (
          <SearchResultRow key={hit.documentId} hit={hit} terms={result.terms} includeArchived={model.includeArchived} />
        ))}
      </ul>
      <nav aria-label="Search pages" className="mt-4 flex gap-3 text-sm">
        {result.page > 1 && <Link className="underline" href={pageHref(model, result.page - 1)}>Previous</Link>}
        {result.hasNext && <Link className="underline" href={pageHref(model, result.page + 1)}>Next</Link>}
      </nav>
    </>
  );
}

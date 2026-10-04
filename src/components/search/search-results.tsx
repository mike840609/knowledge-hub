import Link from "next/link";
import type { SearchPageModel } from "@/server/search-read";
import { SearchResultRow } from "@/components/search/search-result-row";
import { SearchResultList } from "@/components/search/search-result-list";

function pageHref(model: SearchPageModel, page: number): string {
  const params = new URLSearchParams({ q: model.q, scope: model.scope });
  if (model.scope === "workspace" && model.sourceId) params.set("source", model.sourceId);
  for (const key of ["path", "from", "to", "offset", "sort"] as const) if (model[key]) params.set(key, model[key]!);
  if (model.includeArchived) params.set("archived", "1");
  if (page > 1) params.set("page", String(page));
  return `/w/${model.workspaceId}/search?${params.toString()}`;
}

export function SearchResults({ model }: { model: SearchPageModel }) {
  if (model.filterError) return <p role="alert" className="text-body text-kh-danger">{model.filterError}</p>;
  if (model.timedOut) {
    return (
      <p role="alert" className="rounded-md border border-kh-border p-6 text-body text-kh-danger">
        Search timed out. Narrow the scope or add filters, then try again.
      </p>
    );
  }
  const result = model.result;
  if (result === null) {
    return <p className="rounded-md bg-kh-bg-subtle p-6 text-body text-kh-text-muted">Enter a keyword or choose a source, path or date range.</p>;
  }
  if (result.tooLong) {
    return <p role="alert" className="rounded-md border border-kh-border p-6 text-body text-kh-danger">Query is too long; use at most 200 characters.</p>;
  }
  if (result.hits.length === 0) {
    return <p className="rounded-md bg-kh-bg-subtle p-6 text-body text-kh-text-muted">No results for this query.</p>;
  }
  return (
    <>
      <SearchResultList label="Search results">
        {result.hits.map((hit) => (
          <SearchResultRow
            key={hit.documentId}
            hit={hit}
            terms={result.terms}
            includeArchived={model.includeArchived}
            showWorkspace={model.scope === "all"}
          />
        ))}
      </SearchResultList>
      <nav aria-label="Search pages" className="mt-4 flex gap-3 text-body">
        {result.page > 1 && <Link className="underline" href={pageHref(model, result.page - 1)}>Previous</Link>}
        {result.hasNext && <Link className="underline" href={pageHref(model, result.page + 1)}>Next</Link>}
      </nav>
    </>
  );
}

import { Search, FileText } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonClasses } from "@/components/ui/button";
import { WorkspaceContentActions } from "@/components/knowledge/workspace-content-actions";
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
  if (model.result?.tooLong) {
    return <p role="alert" className="rounded-md border border-kh-border p-6 text-body text-kh-danger">Query is too long; use at most 200 characters.</p>;
  }
  if (model.hasDocuments === false && model.scope === "workspace") return <EmptyState icon={FileText} title="No saved documents yet" description="Search finds words in your saved documents. Import a Markdown folder or create a note, then search for a phrase from its content." action={<WorkspaceContentActions workspaceId={model.workspaceId} />} />;
  const result = model.result;
  if (result === null) {
    return <p className="rounded-md bg-kh-bg-subtle p-6 text-body text-kh-text-muted">Enter a keyword or choose a source, path or date range.</p>;
  }
  if (result.hits.length === 0) {
    const filtered = Boolean(model.sourceId || model.path || model.from || model.to || model.includeArchived || model.page > 1);
    const params = new URLSearchParams({ q: model.q, scope: model.scope });
    return <EmptyState icon={Search} title="No results for this query." description={filtered ? "Keep your keyword and remove the source, path or date filters to search more broadly." : "Try a shorter keyword or a phrase from a document. You can also browse your saved knowledge."} action={filtered ? <Link className={buttonClasses({ variant: "secondary" })} href={`/w/${model.workspaceId}/search?${params}`}>Search without filters</Link> : <Link className={buttonClasses({ variant: "secondary" })} href={`/w/${model.workspaceId}/knowledge`}>Browse documents</Link>} />;
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

import { SearchForm } from "@/components/search/search-form";
import { SearchResults } from "@/components/search/search-results";
import { firstSearchParam, type SearchParamValue } from "@/lib/search-params";
import { getSearchPageModel } from "@/server/search-read";

export default async function WorkspaceSearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams?: Promise<{
    q?: SearchParamValue;
    scope?: SearchParamValue;
    source?: SearchParamValue;
    archived?: SearchParamValue;
    page?: SearchParamValue;
  }>;
}) {
  const { workspaceId } = await params;
  const query = await searchParams;
  const q = firstSearchParam(query?.q);
  const scope = firstSearchParam(query?.scope);
  const source = firstSearchParam(query?.source);
  const archived = firstSearchParam(query?.archived);
  const page = firstSearchParam(query?.page);
  const parsedPage = Number.parseInt(page ?? "1", 10);
  const model = await getSearchPageModel(workspaceId, {
    q: q ?? "",
    scope: scope === "all" ? "all" : "workspace",
    sourceId: source ? source : null,
    includeArchived: archived === "1",
    page: Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1,
  });
  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="text-2xl font-semibold text-kh-text">Search</h1>
      <p className="mt-1 text-sm text-kh-text-muted">{model.workspaceName}</p>
      <div className="mt-5">
        <SearchForm
          workspaceId={model.workspaceId}
          q={model.q}
          scope={model.scope}
          sourceId={model.sourceId}
          includeArchived={model.includeArchived}
          sources={model.sources}
        />
      </div>
      <div className="mt-6">
        <SearchResults model={model} />
      </div>
    </main>
  );
}

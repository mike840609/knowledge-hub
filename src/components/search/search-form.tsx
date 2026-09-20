import type { SourceView } from "@/modules/knowledge/application/knowledge-query-service";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";

/** A plain GET form: shareable URLs, and it works without JavaScript. */
export function SearchForm({
  workspaceId, q, scope, sourceId, includeArchived, sources,
}: {
  workspaceId: string;
  q: string;
  scope: "workspace" | "all";
  sourceId: string | null;
  includeArchived: boolean;
  sources: SourceView[];
}) {
  return (
    <form action={`/w/${workspaceId}/search`} method="get" role="search" className="space-y-3">
      <div className="flex items-center gap-2 rounded-md border border-kh-border bg-kh-bg pl-3 transition-colors focus-within:border-kh-focus focus-within:ring-2 focus-within:ring-kh-focus">
        <Search size={18} strokeWidth={2} className="shrink-0 text-kh-text-muted" aria-hidden="true" />
        <label htmlFor="search-q" className="sr-only">Search knowledge</label>
        <input id="search-q" name="q" type="search" defaultValue={q} autoComplete="off" placeholder="Search documents…" className="h-11 min-w-0 flex-1 bg-transparent text-body text-kh-text outline-none placeholder:text-kh-text-muted" />
        <Button type="submit" className="m-1 min-h-9 px-4 py-1.5">Search</Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex min-h-9 items-center gap-2 rounded-md border border-kh-border bg-kh-bg-subtle pl-3 pr-2 text-caption text-kh-text-muted" htmlFor="search-scope">
          Scope
          <select
            id="search-scope"
            name="scope"
            defaultValue={scope}
            className="max-w-[11rem] bg-transparent py-1.5 text-caption font-medium text-kh-text outline-none focus-visible:ring-2 focus-visible:ring-kh-focus"
          >
            <option value="workspace">This workspace</option>
            <option value="all">All my workspaces</option>
          </select>
        </label>
        {scope === "workspace" && (
          <label className="inline-flex min-h-9 items-center gap-2 rounded-md border border-kh-border bg-kh-bg-subtle pl-3 pr-2 text-caption text-kh-text-muted" htmlFor="search-source">
            Source
            <select
              id="search-source"
              name="source"
              defaultValue={sourceId ?? ""}
              className="max-w-[11rem] bg-transparent py-1.5 text-caption font-medium text-kh-text outline-none focus-visible:ring-2 focus-visible:ring-kh-focus"
            >
              <option value="">All sources</option>
              {sources.map((source) => (
                <option key={source.id} value={source.id}>{source.name}</option>
              ))}
            </select>
          </label>
        )}
        <label className="inline-flex min-h-9 items-center gap-2 rounded-md px-2 text-caption text-kh-text-muted hover:bg-kh-bg-hover">
          <input type="checkbox" name="archived" value="1" defaultChecked={includeArchived} className="accent-kh-primary" />
          Include archived
        </label>
      </div>
    </form>
  );
}

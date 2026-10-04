import type { SearchFilterInput } from "@/modules/knowledge/domain/search-filters";
import { SearchDateZone } from "./search-date-zone";
import type { SourceView } from "@/modules/knowledge/application/knowledge-query-service";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { LiveSearchSubmit } from "./live-search-submit";

/**
 * A plain GET form: shareable URLs, and it works without JavaScript. With
 * JavaScript it searches as the reader types (`LiveSearchSubmit`).
 */
export function SearchForm({
  workspaceId, q, scope, sourceId, includeArchived, sources, teamsEnabled = true, filters = {},
}: {
  filters?: SearchFilterInput;
  workspaceId: string;
  q: string;
  scope: "workspace" | "all";
  sourceId: string | null;
  includeArchived: boolean;
  sources: SourceView[];
  teamsEnabled?: boolean;
}) {
  // The query field and its submit button sit side by side on the `lg` rung
  // rather than nesting the button inside a shared border box. That box was
  // the reason this form carried a 44px input and a button reshaped through
  // `className` — neither height was on the ladder, and a nested control can
  // never line up with the one that contains it.
  return (
    <form action={`/w/${workspaceId}/search`} method="get" role="search" className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-kh-text-muted" aria-hidden="true" />
          <label htmlFor="search-q" className="sr-only">Search knowledge</label>
          {/* Icon-clearance padding is geometry, not rhythm: left-3 + w-4 icon
              + a gap-2 gutter. The named geometry class keeps icon clearance separate from the
              spacing rhythm. */}
          <Input id="search-q" name="q" size="lg" type="search" defaultValue={q} autoComplete="off" placeholder="Search documents…" className="kh-search-field" />
        </div>
        <LiveSearchSubmit />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="search-path" className="text-caption text-kh-text-muted">Path
          <Input id="search-path" name="path" defaultValue={filters.path ?? ""} placeholder="docs/runbooks" className="mt-1" />
        </label>
        <label htmlFor="search-from" className="text-caption text-kh-text-muted">Updated from
          <Input id="search-from" name="from" type="date" defaultValue={filters.from ?? ""} className="mt-1" />
        </label>
        <label htmlFor="search-to" className="text-caption text-kh-text-muted">Updated to
          <Input id="search-to" name="to" type="date" defaultValue={filters.to ?? ""} className="mt-1" />
        </label>
        <label htmlFor="search-sort" className="text-caption text-kh-text-muted">Sort
          <Select id="search-sort" name="sort" defaultValue={filters.sort ?? "relevance"} className="mt-1">
            <option value="relevance">Relevance</option><option value="newest">Newest first</option><option value="oldest">Oldest first</option>
          </Select>
        </label>
      </div>
      <SearchDateZone offset={filters.offset} />
      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex items-center gap-2 text-caption text-kh-text-muted" htmlFor="search-scope">
          Scope
          <Select id="search-scope" name="scope" defaultValue={scope} className="max-w-[11rem]">
            <option value="workspace">This workspace</option>
            <option value="all" disabled={!teamsEnabled}>All my workspaces{teamsEnabled ? "" : " · Teams coming soon"}</option>
          </Select>
        </label>
        {scope === "workspace" && (
          <label className="inline-flex items-center gap-2 text-caption text-kh-text-muted" htmlFor="search-source">
            Source
            <Select id="search-source" name="source" defaultValue={sourceId ?? ""} className="max-w-[11rem]">
              <option value="">All sources</option>
              {sources.map((source) => (
                <option key={source.id} value={source.id}>{source.name}</option>
              ))}
            </Select>
          </label>
        )}
        <label className="inline-flex min-h-8 items-center gap-2 rounded-md px-2 text-caption text-kh-text-muted hover:bg-kh-bg-hover">
          <input type="checkbox" name="archived" value="1" defaultChecked={includeArchived} className="accent-kh-primary" />
          Include archived
        </label>
      </div>
    </form>
  );
}

import type { SearchFilterInput } from "@/modules/knowledge/domain/search-filters";
import { SearchDateZone } from "./search-date-zone";
import type { SourceView } from "@/modules/knowledge/application/knowledge-query-service";
import Link from "next/link";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { LiveSearchSubmit } from "./live-search-submit";
import { Label } from "@/components/ui/label";

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
  const active = [filters.path && `Path: ${filters.path}`, filters.from && `From: ${filters.from}`, filters.to && `To: ${filters.to}`, filters.sort && filters.sort !== "relevance" && `Sort: ${filters.sort}`, scope === "all" && "All workspaces", sourceId && `Source: ${sources.find(s => s.id === sourceId)?.name ?? sourceId}`, includeArchived && "Archived included"].filter(Boolean);
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
      {active.length ? <div className="flex flex-wrap items-center gap-2 text-caption text-kh-text-secondary" aria-label="Active search filters"><span>{active.join(" · ")}</span><Link className="kh-focus-ring rounded-md text-kh-link" href={`/w/${workspaceId}/search?${new URLSearchParams({q, scope})}`}>Clear filters</Link></div> : null}
      <details open={active.length > 0} className="border-b border-kh-border pb-3">
      <summary className="kh-focus-ring w-fit cursor-pointer rounded-md text-body-sm text-kh-text-secondary">Advanced filters{active.length ? ` (${active.length})` : ""}</summary>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Label htmlFor="search-path">Path
          <Input id="search-path" name="path" defaultValue={filters.path ?? ""} placeholder="docs/runbooks" className="mt-1" />
        </Label>
        <Label htmlFor="search-from">Updated from
          <Input id="search-from" name="from" type="date" defaultValue={filters.from ?? ""} className="mt-1" />
        </Label>
        <Label htmlFor="search-to">Updated to
          <Input id="search-to" name="to" type="date" defaultValue={filters.to ?? ""} className="mt-1" />
        </Label>
        <Label inline htmlFor="search-sort">Sort
          <Select id="search-sort" name="sort" defaultValue={filters.sort ?? "relevance"}>
            <option value="relevance">Relevance</option><option value="newest">Newest first</option><option value="oldest">Oldest first</option>
          </Select>
        </Label>
      </div>
      <SearchDateZone offset={filters.offset} />
      <div className="flex flex-wrap items-center gap-3">
        <Label inline htmlFor="search-scope">
          Scope
          <Select id="search-scope" name="scope" defaultValue={scope} className="max-w-[11rem]">
            <option value="workspace">This workspace</option>
            <option value="all" disabled={!teamsEnabled}>All my workspaces{teamsEnabled ? "" : " · Teams coming soon"}</option>
          </Select>
        </Label>
        {scope === "workspace" && (
          <Label inline htmlFor="search-source">
            Source
            <Select id="search-source" name="source" defaultValue={sourceId ?? ""} className="max-w-[11rem]">
              <option value="">All sources</option>
              {sources.map((source) => (
                <option key={source.id} value={source.id}>{source.name}</option>
              ))}
            </Select>
          </Label>
        )}
        <label className="inline-flex min-h-8 items-center gap-2 rounded-md px-2 text-caption text-kh-text-muted hover:bg-kh-bg-hover">
          <input type="checkbox" name="archived" value="1" defaultChecked={includeArchived} />
          Include archived
        </label>
      </div>
      </details>
    </form>
  );
}

import type { SourceView } from "@/modules/knowledge/application/knowledge-query-service";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

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
          <Input id="search-q" name="q" size="lg" type="search" defaultValue={q} autoComplete="off" placeholder="Search documents…" className="pl-9" />
        </div>
        <Button type="submit" size="lg">Search</Button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex items-center gap-2 text-caption text-kh-text-muted" htmlFor="search-scope">
          Scope
          <Select id="search-scope" name="scope" defaultValue={scope} className="max-w-[11rem]">
            <option value="workspace">This workspace</option>
            <option value="all">All my workspaces</option>
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

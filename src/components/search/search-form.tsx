import type { SourceView } from "@/modules/knowledge/application/knowledge-query-service";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
    <form action={`/w/${workspaceId}/search`} method="get" className="flex flex-col gap-3">
      <div>
        <Label htmlFor="search-q">Search knowledge</Label>
        <Input id="search-q" name="q" type="search" defaultValue={q} autoComplete="off" placeholder="關鍵字 / keyword" />
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="search-scope">Scope</Label>
          <select
            id="search-scope"
            name="scope"
            defaultValue={scope}
            className="min-h-10 rounded-md border border-kh-border bg-kh-bg px-3 py-2 text-sm text-kh-text focus:border-kh-focus focus-visible:ring-2 focus-visible:ring-kh-focus"
          >
            <option value="workspace">This workspace</option>
            <option value="all">All my workspaces</option>
          </select>
        </div>
        {scope === "workspace" && (
          <div>
            <Label htmlFor="search-source">Source</Label>
            <select
              id="search-source"
              name="source"
              defaultValue={sourceId ?? ""}
              className="min-h-10 rounded-md border border-kh-border bg-kh-bg px-3 py-2 text-sm text-kh-text focus:border-kh-focus focus-visible:ring-2 focus-visible:ring-kh-focus"
            >
              <option value="">All sources</option>
              {sources.map((source) => (
                <option key={source.id} value={source.id}>{source.name}</option>
              ))}
            </select>
          </div>
        )}
        <label className="flex min-h-10 items-center gap-2 text-sm text-kh-text">
          <input type="checkbox" name="archived" value="1" defaultChecked={includeArchived} />
          Show archived
        </label>
        <Button type="submit">Search</Button>
      </div>
    </form>
  );
}

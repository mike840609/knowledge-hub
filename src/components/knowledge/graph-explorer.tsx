"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useOptimistic, useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { GraphCanvas } from "./graph-canvas";
import { GraphList } from "./graph-list";
import type { GraphViewData } from "./graph-model";
import { LinkIndexNote } from "./link-index-note";

export type GraphFilters = {
  sourceId: string | null;
  /** Documents nothing links to or from. Shown unless turned off. */
  orphans: boolean;
  /** Targets that name no document. Hidden unless turned on. */
  unresolved: boolean;
  view: "graph" | "list";
  focusId: string | null;
};

/** The URL that carries a set of filters, so a graph can be shared, bookmarked and stepped back through. */
export function graphQuery(filters: GraphFilters): string {
  const params = new URLSearchParams();
  if (filters.sourceId) params.set("source", filters.sourceId);
  if (!filters.orphans) params.set("orphans", "0");
  if (filters.unresolved) params.set("unresolved", "1");
  if (filters.view === "list") params.set("view", "list");
  if (filters.focusId) params.set("focus", filters.focusId);
  const query = params.toString();
  return query === "" ? "" : `?${query}`;
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-body-sm text-kh-text-secondary">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="accent-kh-primary" />
      {label}
    </label>
  );
}

/**
 * The graph page's interactive part: filters (which go in the URL and are
 * answered by the server, so the layout is always the server's), the find box
 * (which only highlights, and is answered here), and the choice of drawing or
 * table.
 */
export function GraphExplorer({
  workspaceId,
  data,
  filters,
  sources,
  total,
  truncated,
  staleDocuments,
}: {
  workspaceId: string;
  data: GraphViewData;
  filters: GraphFilters;
  sources: { id: string; name: string }[];
  total: { documents: number; edges: number };
  truncated: { shown: number; total: number } | null;
  staleDocuments: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  // A filter is answered by the server (it lays the graph out), which takes a
  // round trip; the control shows the reader's choice at once and settles on
  // the server's answer when it arrives, rather than sitting unchanged for the
  // length of the request as if the click had not landed.
  const [pending, startTransition] = useTransition();
  const [shown, setShown] = useOptimistic(filters, (current, next: Partial<GraphFilters>) => ({ ...current, ...next }));
  const change = (next: Partial<GraphFilters>) =>
    startTransition(() => {
      setShown(next);
      router.replace(`${pathname}${graphQuery({ ...filters, ...next })}`, { scroll: false });
    });
  const links = data.edges.length;
  const summary = `Knowledge graph, ${data.nodes.length} ${data.nodes.length === 1 ? "node" : "nodes"}, ${links} ${links === 1 ? "link" : "links"}`;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div role="group" aria-label="View" className="flex items-center gap-1 rounded-md bg-kh-bg-subtle p-0.5">
          {(["graph", "list"] as const).map((view) => (
            <Link
              key={view}
              href={`${pathname}${graphQuery({ ...filters, view })}`}
              replace
              scroll={false}
              // A link to the page it is on: never prefetched (see LocalGraph).
              prefetch={false}
              aria-current={filters.view === view ? "page" : undefined}
              className={`rounded-sm px-2.5 py-1 text-body-sm kh-focus-ring ${
                filters.view === view ? "bg-kh-bg font-medium text-kh-text shadow-popover" : "text-kh-text-muted hover:text-kh-text"
              }`}
            >
              {view === "graph" ? "Graph" : "List"}
            </Link>
          ))}
        </div>
        {/* The field primitives fill their container, so the width belongs to a wrapper. */}
        <div className="w-56">
          <label className="sr-only" htmlFor="graph-find">Find a document</label>
          <Input
            id="graph-find"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a document"
          />
        </div>
        {sources.length > 1 ? (
          <div className="w-44">
            <label className="sr-only" htmlFor="graph-source">Source</label>
            <Select id="graph-source" value={shown.sourceId ?? ""} onChange={(event) => change({ sourceId: event.target.value || null })}>
              <option value="">All sources</option>
              {sources.map((source) => (
                <option key={source.id} value={source.id}>{source.name}</option>
              ))}
            </Select>
          </div>
        ) : null}
        <Toggle label="Orphans" checked={shown.orphans} onChange={(orphans) => change({ orphans })} />
        <Toggle label="Unresolved" checked={shown.unresolved} onChange={(unresolved) => change({ unresolved })} />
        <p className="ml-auto text-caption text-kh-text-muted" data-graph-summary>
          {total.documents} {total.documents === 1 ? "document" : "documents"} · {total.edges} {total.edges === 1 ? "link" : "links"}
        </p>
      </div>
      <LinkIndexNote stale={staleDocuments} />
      {truncated ? (
        <p role="status" className="rounded-md border border-kh-border bg-kh-bg-subtle px-3 py-2 text-body-sm text-kh-text-secondary">
          Showing the {truncated.shown.toLocaleString("en-US")} best-connected of {truncated.total.toLocaleString("en-US")}. Filter by source to see the rest.
        </p>
      ) : null}
      <div
        aria-busy={pending}
        className={`min-h-[24rem] flex-1 overflow-hidden rounded-md border border-kh-border bg-kh-bg-raised transition-opacity ${pending ? "opacity-60" : ""}`}
      >
        {filters.view === "list" ? (
          <div className="h-full overflow-y-auto p-3">
            <GraphList data={data} query={query} />
          </div>
        ) : data.edges.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center" data-graph-empty>
            <p className="text-title font-semibold text-kh-text">No links between documents yet</p>
            <p className="mt-2 max-w-panel text-body text-kh-text-muted">
              Write <code className="rounded-md bg-kh-bg-subtle px-1 py-0.5 font-mono text-body-sm">[[Document title]]</code> in a document and the relationship appears here.
            </p>
            {data.nodes.length > 0 ? (
              <Link href={`/w/${workspaceId}/graph${graphQuery({ ...filters, view: "list" })}`} prefetch={false} className="mt-4 rounded-md text-body text-kh-link underline underline-offset-2 kh-focus-ring">
                See the {data.nodes.length} {data.nodes.length === 1 ? "document" : "documents"} as a list
              </Link>
            ) : null}
          </div>
        ) : (
          <GraphCanvas data={data} focusId={filters.focusId} query={query} ariaLabel={summary} />
        )}
      </div>
    </div>
  );
}

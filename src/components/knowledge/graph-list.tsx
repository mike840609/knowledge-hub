"use client";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { matchesQuery, type GraphViewData } from "./graph-model";

/**
 * The graph as a table: the same nodes, with what a drawing can only suggest —
 * exactly how many documents link in and out. It is the complete alternative
 * for a reader who cannot use the drawing (a screen reader, a keyboard, a
 * phone), not a secondary view: everything the graph offers is here.
 */
export function GraphList({ data, query }: { data: GraphViewData; query: string }) {
  const [sort, setSort] = useState<{key: "title" | "inDegree" | "outDegree"; ascending: boolean}>({key:"title",ascending:true});
  function order(key: typeof sort.key) { setSort(current => ({key, ascending:current.key === key ? !current.ascending : key === "title"})); }
  const heading = (key: typeof sort.key, label: string) => <button type="button" className="kh-focus-ring inline-flex min-h-6 items-center gap-1 rounded-md" onClick={() => order(key)}>{label}{sort.key === key ? (sort.ascending ? <ArrowUp size={12} aria-hidden="true" /> : <ArrowDown size={12} aria-hidden="true" />) : ""}</button>;
  const rows = data.nodes.filter((node) => matchesQuery(node, query)).sort((a,b) => {
    const delta = sort.key === "title" ? a.title.localeCompare(b.title) : a[sort.key] - b[sort.key];
    return (sort.ascending ? delta : -delta) || a.id.localeCompare(b.id);
  });
  if (rows.length === 0) {
    return <p className="px-3 py-6 text-body text-kh-text-muted">{query.trim() === "" ? "No documents to list." : "No documents match."}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full table-fixed border-collapse text-body-sm">
        <caption className="sr-only">Documents and how many links come in and go out</caption>
        <thead>
          <tr className="text-left text-caption text-kh-text-muted">
            <th scope="col" aria-sort={sort.key === "title" ? (sort.ascending ? "ascending" : "descending") : "none"} className="sticky top-0 border-b border-kh-border bg-kh-bg-subtle px-3 py-2 font-medium">{heading("title", "Document")}</th>
            <th scope="col" className="sticky top-0 hidden w-40 border-b border-kh-border bg-kh-bg-subtle px-3 py-2 font-medium sm:table-cell">Source</th>
            <th scope="col" aria-sort={sort.key === "inDegree" ? (sort.ascending ? "ascending" : "descending") : "none"} className="sticky top-0 hidden w-20 border-b border-kh-border bg-kh-bg-subtle px-3 py-2 text-right font-medium sm:table-cell">{heading("inDegree", "Links in")}</th>
            <th scope="col" aria-sort={sort.key === "outDegree" ? (sort.ascending ? "ascending" : "descending") : "none"} className="sticky top-0 hidden w-20 border-b border-kh-border bg-kh-bg-subtle px-3 py-2 text-right font-medium sm:table-cell">{heading("outDegree", "Links out")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((node) => (
            <tr key={node.id} className="border-b border-kh-border last:border-b-0 hover:bg-kh-bg-hover">
              <th scope="row" className="max-w-0 px-3 py-2 text-left font-normal">
                {node.href ? (
                  <Link href={node.href} className="kh-focus-ring line-clamp-2 block min-h-6 rounded-md text-kh-text hover:text-kh-link sm:line-clamp-none sm:truncate">
                    {node.title}
                  </Link>
                ) : (
                  <span className="flex items-center gap-2 text-kh-text-secondary">
                    <span className="truncate">{node.title}</span>
                    <Badge variant="outline">Missing document</Badge>
                    {node.createHref ? (
                      <Link
                        href={node.createHref}
                        prefetch={false}
                        data-create-link
                        aria-label={`Create a document for “${node.title}”`}
                        className="shrink-0 rounded-md px-1 text-caption text-kh-link underline underline-offset-2 kh-focus-ring"
                      >
                        Create
                      </Link>
                    ) : null}
                  </span>
                )}
                <span className="mt-1 flex flex-wrap items-center gap-1 text-caption text-kh-text-muted sm:hidden">{node.sourceName ?? "—"}{node.inDegree || node.outDegree ? ` · ${node.inDegree} in · ${node.outDegree} out` : ""}</span>
              </th>
              <td className="hidden px-3 py-2 text-kh-text-muted sm:table-cell">{node.sourceName ?? "—"}</td>
              <td className="hidden px-3 py-2 text-right tabular-nums text-kh-text sm:table-cell">{node.inDegree}</td>
              <td className="hidden px-3 py-2 text-right tabular-nums text-kh-text sm:table-cell">{node.outDegree}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

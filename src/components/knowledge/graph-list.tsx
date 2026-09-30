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
  const rows = data.nodes.filter((node) => matchesQuery(node, query));
  if (rows.length === 0) {
    return <p className="px-3 py-6 text-body text-kh-text-muted">{query.trim() === "" ? "No documents to list." : "No document matches."}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-body-sm">
        <caption className="sr-only">Documents and how many links come in and go out</caption>
        <thead>
          <tr className="text-left text-caption text-kh-text-muted">
            <th scope="col" className="sticky top-0 border-b border-kh-border bg-kh-bg-subtle px-3 py-2 font-medium">Document</th>
            <th scope="col" className="sticky top-0 border-b border-kh-border bg-kh-bg-subtle px-3 py-2 font-medium">Source</th>
            <th scope="col" className="sticky top-0 border-b border-kh-border bg-kh-bg-subtle px-3 py-2 text-right font-medium">Links in</th>
            <th scope="col" className="sticky top-0 border-b border-kh-border bg-kh-bg-subtle px-3 py-2 text-right font-medium">Links out</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((node) => (
            <tr key={node.id} className="border-b border-kh-border last:border-b-0 hover:bg-kh-bg-hover">
              <th scope="row" className="max-w-0 px-3 py-2 text-left font-normal">
                {node.href ? (
                  <Link href={node.href} className="block truncate rounded-md text-kh-link hover:underline kh-focus-ring">
                    {node.title}
                  </Link>
                ) : (
                  <span className="flex items-center gap-2 text-kh-text-secondary">
                    <span className="truncate">{node.title}</span>
                    <Badge variant="outline">Unresolved</Badge>
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
              </th>
              <td className="px-3 py-2 text-kh-text-muted">{node.sourceName ?? "—"}</td>
              <td className="px-3 py-2 text-right tabular-nums text-kh-text">{node.inDegree}</td>
              <td className="px-3 py-2 text-right tabular-nums text-kh-text">{node.outDegree}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

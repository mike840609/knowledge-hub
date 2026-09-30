import { GraphExplorer, type GraphFilters } from "@/components/knowledge/graph-explorer";
import { graphViewFrom } from "@/components/knowledge/graph-model";
import { createHrefForNode } from "@/lib/create-from-link";
import { PageHeader } from "@/components/shell/page-header";
import { StatusMessage } from "@/components/ui/status-message";
import { firstSearchParam, type SearchParamValue } from "@/lib/search-params";
import { getWorkspaceShellModel } from "@/server/knowledge-read";
import { getWorkspaceGraphModel } from "@/server/link-graph-read";

export const metadata = { title: "Graph" };

/**
 * The Workspace's link graph (spec §10). Filters live in the URL and are
 * answered here, on the server, so the layout the browser draws is always the
 * server's and a filtered graph can be shared or stepped back through.
 * `focus` only says which document to emphasise; it selects among nodes the
 * service already authorized and grants nothing.
 */
export default async function WorkspaceGraphPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams?: Promise<{ source?: SearchParamValue; orphans?: SearchParamValue; unresolved?: SearchParamValue; view?: SearchParamValue; focus?: SearchParamValue }>;
}) {
  const { workspaceId } = await params;
  const query = await searchParams;
  const sourceParam = firstSearchParam(query?.source);
  const focusParam = firstSearchParam(query?.focus);

  const [shell, graph] = await Promise.all([
    getWorkspaceShellModel(workspaceId),
    getWorkspaceGraphModel(workspaceId, {
      sourceId: sourceParam || null,
      includeOrphans: firstSearchParam(query?.orphans) !== "0",
      includeUnresolved: firstSearchParam(query?.unresolved) === "1",
    }),
  ]);
  if (!shell || !graph) {
    return <StatusMessage title="Not found or no access" description="This content does not exist or you do not have access to it." />;
  }

  // Whether an unresolved node offers to make its document is the reader's capability; what happens when it is followed is the create request's.
  const canWrite = shell.access.actions.canWrite === true;
  const data = graphViewFrom(workspaceId, graph, (node) => createHrefForNode(workspaceId, node, canWrite));
  const filters: GraphFilters = {
    sourceId: sourceParam && graph.sources.some((source) => source.id === sourceParam) ? sourceParam : null,
    orphans: firstSearchParam(query?.orphans) !== "0",
    unresolved: firstSearchParam(query?.unresolved) === "1",
    view: firstSearchParam(query?.view) === "list" ? "list" : "graph",
    // Only a node that is on screen can be emphasised.
    focusId: focusParam && data.nodes.some((node) => node.id === focusParam) ? focusParam : null,
  };

  return (
    <div className="flex h-full min-h-0 flex-col px-6 py-4">
      <PageHeader location={shell.workspace.name} locationHref={`/w/${workspaceId}/knowledge`} title="Graph" />
      <div className="mt-3 min-h-0 flex-1">
        <GraphExplorer
          workspaceId={workspaceId}
          data={data}
          filters={filters}
          sources={graph.sources}
          total={graph.total}
          truncated={graph.truncated}
          staleDocuments={graph.index.stale}
        />
      </div>
    </div>
  );
}

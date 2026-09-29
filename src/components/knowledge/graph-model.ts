import type { WorkspaceGraphView } from "@/modules/knowledge/application/knowledge-link-service";
import type { GraphEdge, GraphNode } from "@/modules/knowledge/domain/link-graph";
import { layoutGraph } from "@/lib/graph/layout";
import { documentPath } from "./rendered-links";

/** A node as the browser draws it: what it is, where it goes when clicked, and where it sits. */
export type GraphViewNode = {
  id: string;
  kind: "DOCUMENT" | "UNRESOLVED";
  title: string;
  /** `null` for a target nothing answers to: there is no page to open. */
  href: string | null;
  sourceName: string | null;
  inDegree: number;
  outDegree: number;
  x: number;
  y: number;
  radius: number;
};

export type GraphViewData = {
  nodes: GraphViewNode[];
  edges: GraphEdge[];
  /** The drawing's extent; also the `viewBox`. */
  width: number;
  height: number;
};

/**
 * Lays the graph out and attaches what the browser needs to draw it. Runs on
 * the server (spec D7): the client receives finished coordinates.
 */
export function toGraphViewData(input: {
  workspaceId: string;
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  sourceNames: ReadonlyMap<string, string>;
}): GraphViewData {
  const layout = layoutGraph(input.nodes, input.edges);
  const placed = new Map(layout.nodes.map((node) => [node.id, node]));
  const nodes: GraphViewNode[] = input.nodes.flatMap((node) => {
    const position = placed.get(node.id);
    if (!position) return [];
    return [{
      id: node.id,
      kind: node.kind,
      title: node.title,
      href: node.kind === "DOCUMENT" && node.sourceId ? documentPath(input.workspaceId, node.sourceId, node.id) : null,
      sourceName: node.sourceId ? input.sourceNames.get(node.sourceId) ?? null : null,
      inDegree: node.inDegree,
      outDegree: node.outDegree,
      x: position.x,
      y: position.y,
      radius: position.radius,
    }];
  });
  return { nodes, edges: [...input.edges], width: layout.width, height: layout.height };
}

export function graphViewFrom(workspaceId: string, view: Pick<WorkspaceGraphView, "nodes" | "edges" | "sources">): GraphViewData {
  return toGraphViewData({
    workspaceId,
    nodes: view.nodes,
    edges: view.edges,
    sourceNames: new Map(view.sources.map((source) => [source.id, source.name])),
  });
}

/** Who each node is linked to, in either direction. */
export function adjacency(edges: readonly GraphEdge[]): Map<string, Set<string>> {
  const neighbours = new Map<string, Set<string>>();
  const add = (from: string, to: string) => {
    const set = neighbours.get(from);
    if (set) set.add(to);
    else neighbours.set(from, new Set([to]));
  };
  for (const edge of edges) {
    add(edge.from, edge.to);
    add(edge.to, edge.from);
  }
  return neighbours;
}

/** How a title is shortened where it labels a node. */
export function nodeLabel(title: string, max = 28): string {
  const points = Array.from(title);
  return points.length <= max ? title : `${points.slice(0, max - 1).join("").trimEnd()}…`;
}

/** Whether a node answers to what was typed in the find box. */
export function matchesQuery(node: Pick<GraphViewNode, "title">, query: string): boolean {
  const needle = query.trim().toLowerCase();
  return needle === "" || node.title.toLowerCase().includes(needle);
}

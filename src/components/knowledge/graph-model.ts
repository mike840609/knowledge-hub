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
  /** For a target nothing answers to, where the reader may make the document it names; `null` when they may not, or when no title could be the answer. */
  createHref: string | null;
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
  /** Where to caption the shelf of unlinked nodes; `null` when there is none. */
  unlinked: { x: number; y: number } | null;
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
  /** Where to make the document an unresolved node names (`createHrefForNode`); absent for someone who cannot write. */
  createHref?: (node: GraphNode) => string | null;
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
      createHref: node.kind === "UNRESOLVED" ? input.createHref?.(node) ?? null : null,
      sourceName: node.sourceId ? input.sourceNames.get(node.sourceId) ?? null : null,
      inDegree: node.inDegree,
      outDegree: node.outDegree,
      x: position.x,
      y: position.y,
      radius: position.radius,
    }];
  });
  return { nodes, edges: [...input.edges], width: layout.width, height: layout.height, unlinked: layout.unlinked };
}

export function graphViewFrom(
  workspaceId: string,
  view: Pick<WorkspaceGraphView, "nodes" | "edges" | "sources">,
  createHref?: (node: GraphNode) => string | null,
): GraphViewData {
  return toGraphViewData({
    workspaceId,
    nodes: view.nodes,
    edges: view.edges,
    sourceNames: new Map(view.sources.map((source) => [source.id, source.name])),
    createHref,
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

/** Labels are drawn at this screen size whatever the zoom, so they stay readable and do not swell with the drawing. */
export const LABEL_PX = 11;
/** More labels than this stops helping anyone find anything. */
export const LABEL_LIMIT = 140;

/**
 * How wide a label will be at `px`, without measuring it: a full-width
 * character (CJK, kana, Hangul, full-width forms) is one em and everything
 * else about 0.56. An estimate is enough because it only decides which
 * labels share room, and it errs a little wide so that two chosen labels do
 * not touch.
 */
export function estimateLabelWidth(text: string, px: number): number {
  let em = 0;
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    em += code >= 0x2e80 && code <= 0xffef ? 1 : 0.58;
  }
  return em * px;
}

type LabelNode = Pick<GraphViewNode, "id" | "title" | "x" | "y" | "radius" | "inDegree" | "outDegree">;

/**
 * Which nodes get a label at this zoom (spec §10.3).
 *
 * Labelling all of them makes a dense graph unreadable, and labelling none of
 * them makes it unusable, so labels are given out in priority order — the ones
 * being looked at first (`forced`, shown wherever they fall), then those worth
 * looking at (`boosted`), then the best connected — and a label that would land
 * on one already given, or on another node's dot, waits. Zooming in shrinks
 * every label's footprint in the drawing's own units, so more of them find
 * room: the drawing shows what a reader can act on at this scale and reveals
 * the rest as they come closer.
 *
 * `pxPerUnit` is screen pixels per unit of the drawing, zoom included. Pure
 * and order-independent: the same nodes and scale always give the same set.
 */
export function selectVisibleLabels(
  nodes: readonly LabelNode[],
  options: { pxPerUnit: number; forced?: ReadonlySet<string>; boosted?: ReadonlySet<string>; limit?: number; labelPx?: number },
): Set<string> {
  const { pxPerUnit, forced = new Set<string>(), boosted = new Set<string>(), limit = LABEL_LIMIT, labelPx = LABEL_PX } = options;
  if (!(pxPerUnit > 0)) return new Set();
  const unit = 1 / pxPerUnit;
  const height = labelPx * 1.3 * unit;
  const gap = 2 * unit;
  const margin = 3 * unit;
  const obstacles = nodes.length <= 400;

  const ordered = [...nodes].sort((left, right) => {
    const force = Number(forced.has(right.id)) - Number(forced.has(left.id));
    if (force !== 0) return force;
    // Boosted ones — a hovered node's neighbours, the matches of a search — go
    // first among the rest, but still yield to a label already placed.
    const boost = Number(boosted.has(right.id)) - Number(boosted.has(left.id));
    if (boost !== 0) return boost;
    const degree = right.inDegree + right.outDegree - (left.inDegree + left.outDegree);
    if (degree !== 0) return degree;
    const title = left.title.localeCompare(right.title);
    if (title !== 0) return title;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });

  type Box = { left: number; right: number; top: number; bottom: number };
  const placed: Box[] = [];
  const shown = new Set<string>();
  for (const node of ordered) {
    if (shown.size >= limit && !forced.has(node.id)) break;
    const width = estimateLabelWidth(nodeLabel(node.title), labelPx) * unit;
    const box: Box = {
      left: node.x - width / 2 - margin,
      right: node.x + width / 2 + margin,
      top: node.y + node.radius + gap,
      bottom: node.y + node.radius + gap + height,
    };
    const clash =
      placed.some((other) => box.left < other.right && box.right > other.left && box.top < other.bottom && box.bottom > other.top) ||
      (obstacles &&
        !forced.has(node.id) &&
        nodes.some(
          (other) =>
            other.id !== node.id &&
            other.x + other.radius > box.left &&
            other.x - other.radius < box.right &&
            other.y + other.radius > box.top &&
            other.y - other.radius < box.bottom,
        ));
    if (clash && !forced.has(node.id)) continue;
    placed.push(box);
    shown.add(node.id);
  }
  return shown;
}

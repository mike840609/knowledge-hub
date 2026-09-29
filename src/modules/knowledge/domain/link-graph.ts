import type { ExtractedLink, LinkKind } from "./document-links";
import {
  buildLinkResolver,
  normalizeLinkKey,
  type CatalogDocument,
  type LinkOrigin,
  type LinkResolution,
  type LinkResolver,
} from "./link-resolution";
import type { IndexedDocumentLinks } from "../ports/document-link-repository";

/** Bounds of a graph a browser can draw and a person can read (spec §10). */
export const GRAPH_NODE_LIMIT = 1000;
export const LOCAL_GRAPH_NODE_LIMIT = 60;

/**
 * The key under which a link's resolution is looked up by whoever renders the
 * document. WIKI names compare the way the resolver does; a relative path is
 * kept as written, because what it resolves to depends on the document it is
 * written in, and the lookup is per document.
 */
export function linkLookupKey(kind: LinkKind, target: string): string {
  return kind === "WIKI" ? `WIKI:${normalizeLinkKey(target.replace(/\.(?:md|markdown)$/i, ""))}` : `PATH:${target}`;
}

export type ResolvedEdge = {
  from: string;
  link: ExtractedLink;
  resolution: LinkResolution;
};

/** Resolves every stored edge of the Workspace's documents. Edges of documents outside the catalog are dropped. */
export function resolveEdges(catalog: readonly CatalogDocument[], indexed: readonly IndexedDocumentLinks[]): ResolvedEdge[] {
  const resolver = buildLinkResolver(catalog);
  const origins = new Map<string, LinkOrigin>(
    catalog.map((document) => [document.documentId, { documentId: document.documentId, sourceId: document.sourceId, sourcePath: document.sourcePath }]),
  );
  const edges: ResolvedEdge[] = [];
  for (const { documentId, links } of indexed) {
    const origin = origins.get(documentId);
    if (!origin) continue;
    for (const link of links) edges.push({ from: documentId, link, resolution: resolver.resolve(link, origin) });
  }
  return edges;
}

export type GraphNode = {
  /** A document id, or `unresolved:<key>` for a target nothing in the Workspace answers to. */
  id: string;
  kind: "DOCUMENT" | "UNRESOLVED";
  title: string;
  sourceId: string | null;
  inDegree: number;
  outDegree: number;
};

export type GraphEdge = { from: string; to: string; count: number };

export type LinkGraph = { nodes: GraphNode[]; edges: GraphEdge[] };

export type WorkspaceGraph = LinkGraph & {
  /** Before any filter: the whole Workspace. */
  total: { documents: number; edges: number };
  /** Set when more nodes qualified than fit. */
  truncated: { shown: number; total: number } | null;
};

export type GraphOptions = {
  sourceId?: string | null;
  includeUnresolved?: boolean;
  includeOrphans?: boolean;
  limit?: number;
};

function unresolvedKey(edge: ResolvedEdge): string {
  return `unresolved:${linkLookupKey(edge.link.kind, edge.link.target)}`;
}

function compareNodes(left: GraphNode, right: GraphNode): number {
  const degree = right.inDegree + right.outDegree - (left.inDegree + left.outDegree);
  if (degree !== 0) return degree;
  const title = left.title.localeCompare(right.title);
  if (title !== 0) return title;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

/**
 * The Workspace's link graph (spec §8.3, §10.1). Pure: the same catalog and
 * edges always give the same nodes, in the same order, so a layout computed
 * from it is reproducible.
 */
export function buildWorkspaceGraph(
  catalog: readonly CatalogDocument[],
  edges: readonly ResolvedEdge[],
  options: GraphOptions = {},
): WorkspaceGraph {
  const limit = options.limit ?? GRAPH_NODE_LIMIT;
  const includeOrphans = options.includeOrphans ?? true;
  const includeUnresolved = options.includeUnresolved ?? false;

  // Whole-Workspace figures, before any filter.
  const wholePairs = new Set<string>();
  for (const edge of edges) {
    if (edge.resolution.status === "RESOLVED" && edge.resolution.documentId !== edge.from) wholePairs.add(`${edge.from}\0${edge.resolution.documentId}`);
  }
  const total = { documents: catalog.length, edges: wholePairs.size };

  const included = catalog.filter((document) => options.sourceId == null || document.sourceId === options.sourceId);
  const nodes = new Map<string, GraphNode>();
  for (const document of included) {
    nodes.set(document.documentId, { id: document.documentId, kind: "DOCUMENT", title: document.title, sourceId: document.sourceId, inDegree: 0, outDegree: 0 });
  }

  const counts = new Map<string, GraphEdge>();
  const bump = (from: string, to: string) => {
    const key = `${from}\0${to}`;
    const existing = counts.get(key);
    if (existing) existing.count += 1;
    else counts.set(key, { from, to, count: 1 });
  };

  for (const edge of edges) {
    if (!nodes.has(edge.from)) continue;
    if (edge.resolution.status === "RESOLVED") {
      const to = edge.resolution.documentId;
      if (to !== edge.from && nodes.has(to)) bump(edge.from, to);
    } else if (includeUnresolved) {
      const id = unresolvedKey(edge);
      if (!nodes.has(id)) nodes.set(id, { id, kind: "UNRESOLVED", title: edge.link.target, sourceId: null, inDegree: 0, outDegree: 0 });
      bump(edge.from, id);
    }
  }

  let graphEdges = [...counts.values()];
  const degrees = (list: readonly GraphEdge[]) => {
    for (const node of nodes.values()) {
      node.inDegree = 0;
      node.outDegree = 0;
    }
    for (const edge of list) {
      const from = nodes.get(edge.from);
      const to = nodes.get(edge.to);
      if (from) from.outDegree += edge.count;
      if (to) to.inDegree += edge.count;
    }
  };
  degrees(graphEdges);

  if (!includeOrphans) {
    for (const [id, node] of [...nodes]) {
      if (node.kind === "DOCUMENT" && node.inDegree + node.outDegree === 0) nodes.delete(id);
    }
  }

  let truncated: WorkspaceGraph["truncated"] = null;
  let kept = [...nodes.values()].sort(compareNodes);
  if (kept.length > limit) {
    truncated = { shown: limit, total: kept.length };
    kept = kept.slice(0, limit);
    const keptIds = new Set(kept.map((node) => node.id));
    for (const id of [...nodes.keys()]) if (!keptIds.has(id)) nodes.delete(id);
    graphEdges = graphEdges.filter((edge) => keptIds.has(edge.from) && keptIds.has(edge.to));
    degrees(graphEdges);
    kept = [...nodes.values()].sort(compareNodes);
  }

  const keptIds = new Set(kept.map((node) => node.id));
  graphEdges = graphEdges
    .filter((edge) => keptIds.has(edge.from) && keptIds.has(edge.to))
    .sort((left, right) => (left.from === right.from ? (left.to < right.to ? -1 : 1) : left.from < right.from ? -1 : 1));
  return { nodes: kept, edges: graphEdges, total, truncated };
}

/**
 * The neighbourhood of one node: everything within `depth` links of it,
 * following links in either direction, nearest first when there are more than
 * `limit`. The focus node is always kept and is first.
 */
export function buildLocalGraph(graph: LinkGraph, focusId: string, depth: 1 | 2 = 1, limit = LOCAL_GRAPH_NODE_LIMIT): LinkGraph {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const focus = byId.get(focusId);
  if (!focus) return { nodes: [], edges: [] };

  const neighbours = new Map<string, Set<string>>();
  const link = (from: string, to: string) => {
    if (!neighbours.has(from)) neighbours.set(from, new Set());
    neighbours.get(from)!.add(to);
  };
  for (const edge of graph.edges) {
    link(edge.from, edge.to);
    link(edge.to, edge.from);
  }

  const included = [focus];
  const seen = new Set([focusId]);
  let layer = [focusId];
  for (let distance = 1; distance <= depth && included.length < limit; distance += 1) {
    const next = new Set<string>();
    for (const id of layer) for (const neighbour of neighbours.get(id) ?? []) if (!seen.has(neighbour)) next.add(neighbour);
    const ordered = [...next].map((id) => byId.get(id)!).filter(Boolean).sort(compareNodes);
    for (const node of ordered) {
      if (included.length >= limit) break;
      seen.add(node.id);
      included.push(node);
    }
    layer = ordered.filter((node) => seen.has(node.id)).map((node) => node.id);
  }

  const ids = new Set(included.map((node) => node.id));
  const edges = graph.edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to));
  // Degrees within the neighbourhood, so a node's size means "links shown here".
  const local = included.map((node) => ({ ...node, inDegree: 0, outDegree: 0 }));
  const localById = new Map(local.map((node) => [node.id, node]));
  for (const edge of edges) {
    localById.get(edge.from)!.outDegree += edge.count;
    localById.get(edge.to)!.inDegree += edge.count;
  }
  return { nodes: local, edges };
}

export type Backlink = {
  documentId: string;
  /** How many links in that document point here. */
  count: number;
  /** The first of them, for showing where it sits. */
  firstLine: number;
};

/** The documents that link to `documentId`, excluding itself, in title order. */
export function backlinksTo(documentId: string, catalog: readonly CatalogDocument[], edges: readonly ResolvedEdge[]): Backlink[] {
  const titles = new Map(catalog.map((document) => [document.documentId, document.title]));
  const found = new Map<string, Backlink>();
  for (const edge of edges) {
    if (edge.resolution.status !== "RESOLVED" || edge.resolution.documentId !== documentId || edge.from === documentId) continue;
    const existing = found.get(edge.from);
    if (existing) {
      existing.count += 1;
      existing.firstLine = Math.min(existing.firstLine, edge.link.line);
    } else {
      found.set(edge.from, { documentId: edge.from, count: 1, firstLine: edge.link.line });
    }
  }
  return [...found.values()].sort((left, right) => {
    const title = (titles.get(left.documentId) ?? "").localeCompare(titles.get(right.documentId) ?? "");
    if (title !== 0) return title;
    return left.documentId < right.documentId ? -1 : 1;
  });
}

export type { LinkResolver };

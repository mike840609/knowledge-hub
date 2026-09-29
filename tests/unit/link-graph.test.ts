import { describe, expect, it } from "vitest";
import {
  backlinksTo,
  buildLocalGraph,
  buildWorkspaceGraph,
  linkLookupKey,
  resolveEdges,
} from "@/modules/knowledge/domain/link-graph";
import type { ExtractedLink } from "@/modules/knowledge/domain/document-links";
import type { CatalogDocument } from "@/modules/knowledge/domain/link-resolution";

const SRC = "src-a";
let clock = 0;
const doc = (documentId: string, overrides: Partial<CatalogDocument> = {}): CatalogDocument => ({
  documentId, sourceId: SRC, title: documentId.toUpperCase(), sourcePath: null, createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, ++clock)), ...overrides,
});
const wiki = (target: string, line = 1, ordinal = 0): ExtractedLink => ({ kind: "WIKI", target, fragment: null, display: null, line, ordinal });
const indexed = (documentId: string, ...links: ExtractedLink[]) => ({ documentId, links });

/** a → b, a → c, b → a, d has none, and a → "missing" is unresolved. */
function fixture() {
  const catalog = [doc("a"), doc("b"), doc("c"), doc("d")];
  const edges = resolveEdges(catalog, [
    indexed("a", wiki("B"), wiki("C", 2, 1), wiki("Missing", 3, 2)),
    indexed("b", wiki("A")),
  ]);
  return { catalog, edges };
}

describe("linkLookupKey", () => {
  it("folds WIKI names the way the resolver does, and keeps a relative path as written", () => {
    expect(linkLookupKey("WIKI", "  Query   Master ")).toBe(linkLookupKey("WIKI", "query master"));
    expect(linkLookupKey("WIKI", "Note.md")).toBe(linkLookupKey("WIKI", "note"));
    expect(linkLookupKey("PATH", "../B.md")).not.toBe(linkLookupKey("PATH", "../b.md"));
    expect(linkLookupKey("WIKI", "x")).not.toBe(linkLookupKey("PATH", "x"));
  });
});

describe("resolveEdges", () => {
  it("resolves against the catalog and drops edges of documents that are not in it", () => {
    const catalog = [doc("a"), doc("b")];
    const edges = resolveEdges(catalog, [indexed("a", wiki("B")), indexed("ghost", wiki("A"))]);
    expect(edges.map((edge) => [edge.from, edge.resolution.status])).toEqual([["a", "RESOLVED"]]);
  });
});

describe("buildWorkspaceGraph", () => {
  it("has a node per document and an edge per linked pair, in title order of degree", () => {
    const { catalog, edges } = fixture();
    const graph = buildWorkspaceGraph(catalog, edges);
    expect(graph.nodes.map((node) => node.id)).toEqual(["a", "b", "c", "d"]);
    expect(graph.edges).toEqual([
      { from: "a", to: "b", count: 1 },
      { from: "a", to: "c", count: 1 },
      { from: "b", to: "a", count: 1 },
    ]);
    expect(graph.truncated).toBeNull();
  });

  it("counts degrees per direction and merges repeated links into one edge with a count", () => {
    const catalog = [doc("a"), doc("b")];
    const edges = resolveEdges(catalog, [indexed("a", wiki("B", 1, 0), wiki("b", 2, 1), wiki("B", 3, 2))]);
    const graph = buildWorkspaceGraph(catalog, edges);
    expect(graph.edges).toEqual([{ from: "a", to: "b", count: 3 }]);
    const byId = Object.fromEntries(graph.nodes.map((node) => [node.id, node]));
    expect([byId.a.outDegree, byId.a.inDegree, byId.b.outDegree, byId.b.inDegree]).toEqual([3, 0, 0, 3]);
  });

  it("leaves a document's link to itself out", () => {
    const catalog = [doc("a")];
    const graph = buildWorkspaceGraph(catalog, resolveEdges(catalog, [indexed("a", wiki("A"))]));
    expect(graph.edges).toEqual([]);
    expect(graph.nodes.map((node) => node.outDegree + node.inDegree)).toEqual([0]);
    expect(graph.total.edges).toBe(0);
  });

  it("shows unresolved targets only on request, one node per distinct target", () => {
    const catalog = [doc("a"), doc("b")];
    const edges = resolveEdges(catalog, [indexed("a", wiki("Nowhere")), indexed("b", wiki("nowhere"), wiki("Elsewhere", 2, 1))]);
    const without = buildWorkspaceGraph(catalog, edges);
    expect(without.nodes.every((node) => node.kind === "DOCUMENT")).toBe(true);

    const withGhosts = buildWorkspaceGraph(catalog, edges, { includeUnresolved: true });
    const ghosts = withGhosts.nodes.filter((node) => node.kind === "UNRESOLVED");
    expect(ghosts.map((node) => node.inDegree).sort()).toEqual([1, 2]);
    expect(ghosts.every((node) => node.id.startsWith("unresolved:") && node.sourceId === null)).toBe(true);
  });

  it("drops orphans when asked, counting a link to an unresolved target as no link when those are hidden", () => {
    const { catalog, edges } = fixture();
    const noOrphans = buildWorkspaceGraph(catalog, edges, { includeOrphans: false });
    expect(noOrphans.nodes.map((node) => node.id)).toEqual(["a", "b", "c"]);

    const onlyUnresolvedLink = [doc("x"), doc("y")];
    const graph = buildWorkspaceGraph(onlyUnresolvedLink, resolveEdges(onlyUnresolvedLink, [indexed("x", wiki("Nope"))]), { includeOrphans: false });
    expect(graph.nodes).toEqual([]);
    const shown = buildWorkspaceGraph(onlyUnresolvedLink, resolveEdges(onlyUnresolvedLink, [indexed("x", wiki("Nope"))]), { includeOrphans: false, includeUnresolved: true });
    expect(shown.nodes.map((node) => node.kind).sort()).toEqual(["DOCUMENT", "UNRESOLVED"]);
  });

  it("restricts to one source and drops the edges that cross out of it", () => {
    const catalog = [doc("a"), doc("b"), doc("z", { sourceId: "src-b" })];
    const edges = resolveEdges(catalog, [indexed("a", wiki("B"), wiki("Z", 2, 1)), indexed("z", wiki("A"))]);
    const graph = buildWorkspaceGraph(catalog, edges, { sourceId: SRC });
    expect(graph.nodes.map((node) => node.id).sort()).toEqual(["a", "b"]);
    expect(graph.edges).toEqual([{ from: "a", to: "b", count: 1 }]);
    expect(graph.total).toEqual({ documents: 3, edges: 3 });
  });

  it("keeps the best-connected nodes when there are more than fit, and says so", () => {
    const catalog = [doc("hub"), doc("s1"), doc("s2"), doc("s3"), doc("lonely1"), doc("lonely2")];
    const edges = resolveEdges(catalog, [indexed("hub", wiki("S1"), wiki("S2", 2, 1), wiki("S3", 3, 2))]);
    const graph = buildWorkspaceGraph(catalog, edges, { limit: 3 });
    expect(graph.nodes).toHaveLength(3);
    expect(graph.nodes[0].id).toBe("hub");
    expect(graph.nodes.every((node) => !node.id.startsWith("lonely"))).toBe(true);
    expect(graph.truncated).toEqual({ shown: 3, total: 6 });
    // Degrees are recomputed for what remains, so no edge points at a dropped node.
    const ids = new Set(graph.nodes.map((node) => node.id));
    expect(graph.edges.every((edge) => ids.has(edge.from) && ids.has(edge.to))).toBe(true);
  });

  it("gives the same graph whatever order the inputs arrive in", () => {
    const { catalog, edges } = fixture();
    const forward = buildWorkspaceGraph(catalog, edges, { includeUnresolved: true });
    const backward = buildWorkspaceGraph([...catalog].reverse(), [...edges].reverse(), { includeUnresolved: true });
    expect(backward).toEqual(forward);
  });

  it("is empty for an empty workspace", () => {
    expect(buildWorkspaceGraph([], [])).toEqual({ nodes: [], edges: [], total: { documents: 0, edges: 0 }, truncated: null });
  });
});

describe("buildLocalGraph", () => {
  // chain: a - b - c - d, plus e off a; f unconnected
  const catalog = ["a", "b", "c", "d", "e", "f"].map((id) => doc(id));
  const edges = resolveEdges(catalog, [indexed("a", wiki("B"), wiki("E", 2, 1)), indexed("c", wiki("B")), indexed("d", wiki("C"))]);
  const graph = buildWorkspaceGraph(catalog, edges);

  it("is the focus and its direct neighbours at depth 1, following links either way", () => {
    const local = buildLocalGraph(graph, "b", 1);
    expect(local.nodes.map((node) => node.id).sort()).toEqual(["a", "b", "c"]);
    expect(local.nodes[0].id).toBe("b");
    expect(local.edges).toHaveLength(2);
  });

  it("reaches two links out at depth 2", () => {
    const local = buildLocalGraph(graph, "b", 2);
    expect(local.nodes.map((node) => node.id).sort()).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("does not include what is not connected", () => {
    expect(buildLocalGraph(graph, "b", 2).nodes.map((node) => node.id)).not.toContain("f");
    expect(buildLocalGraph(graph, "f", 2).nodes.map((node) => node.id)).toEqual(["f"]);
  });

  it("keeps the nearest when it must cut, and the focus always", () => {
    const local = buildLocalGraph(graph, "b", 2, 3);
    expect(local.nodes).toHaveLength(3);
    expect(local.nodes[0].id).toBe("b");
    expect(local.nodes.map((node) => node.id)).not.toContain("d");
  });

  it("measures degree within the neighbourhood", () => {
    const local = buildLocalGraph(graph, "b", 1);
    const b = local.nodes.find((node) => node.id === "b")!;
    expect([b.inDegree, b.outDegree]).toEqual([2, 0]);
  });

  it("is empty for a focus that is not in the graph", () => {
    expect(buildLocalGraph(graph, "missing", 1)).toEqual({ nodes: [], edges: [] });
  });
});

describe("backlinksTo", () => {
  it("lists the documents that link here, once each, with a count and the first line", () => {
    const catalog = [doc("a", { title: "Zed" }), doc("b", { title: "Alpha" }), doc("target")];
    const edges = resolveEdges(catalog, [
      indexed("a", wiki("Target", 9, 0)),
      indexed("b", wiki("Target", 5, 0), wiki("target", 2, 1)),
    ]);
    expect(backlinksTo("target", catalog, edges)).toEqual([
      { documentId: "b", count: 2, firstLine: 2 },
      { documentId: "a", count: 1, firstLine: 9 },
    ]);
  });

  it("does not list the document itself, nor links that resolve elsewhere or nowhere", () => {
    const catalog = [doc("a"), doc("target")];
    const edges = resolveEdges(catalog, [indexed("target", wiki("Target")), indexed("a", wiki("Somewhere else"))]);
    expect(backlinksTo("target", catalog, edges)).toEqual([]);
  });
});

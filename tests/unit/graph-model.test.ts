import { describe, expect, it } from "vitest";
import { adjacency, estimateLabelWidth, LABEL_LIMIT, matchesQuery, nodeLabel, selectVisibleLabels, toGraphViewData } from "@/components/knowledge/graph-model";
import type { GraphEdge, GraphNode } from "@/modules/knowledge/domain/link-graph";

const doc = (id: string, title: string, sourceId = "s1"): GraphNode => ({ id, kind: "DOCUMENT", title, sourceId, inDegree: 1, outDegree: 1 });
const ghost = (id: string, title: string): GraphNode => ({ id, kind: "UNRESOLVED", title, sourceId: null, inDegree: 1, outDegree: 0 });

describe("toGraphViewData", () => {
  const nodes = [doc("a", "Alpha"), doc("b", "Beta", "s2"), ghost("unresolved:w:x", "Nowhere")];
  const edges: GraphEdge[] = [{ from: "a", to: "b", count: 1 }, { from: "a", to: "unresolved:w:x", count: 2 }];
  const data = toGraphViewData({ workspaceId: "w1", nodes, edges, sourceNames: new Map([["s1", "Notes"], ["s2", "Vault"]]) });

  it("lays every node out and keeps them in the order it was given", () => {
    expect(data.nodes.map((node) => node.id)).toEqual(["a", "b", "unresolved:w:x"]);
    expect(data.nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y) && node.radius > 0)).toBe(true);
    expect(data.width).toBeGreaterThan(0);
    expect(data.height).toBeGreaterThan(0);
  });

  it("opens a document at its own page, and gives a target that is not there no page at all", () => {
    expect(data.nodes[0].href).toBe("/w/w1/knowledge/s1/a");
    expect(data.nodes[1].href).toBe("/w/w1/knowledge/s2/b");
    expect(data.nodes[2].href).toBeNull();
  });

  it("names the source of a document, and none for an unresolved target", () => {
    expect(data.nodes.map((node) => node.sourceName)).toEqual(["Notes", "Vault", null]);
  });

  it("passes the edges through untouched", () => {
    expect(data.edges).toEqual(edges);
  });

  it("is the same every time", () => {
    expect(toGraphViewData({ workspaceId: "w1", nodes, edges, sourceNames: new Map() })).toEqual(
      toGraphViewData({ workspaceId: "w1", nodes, edges, sourceNames: new Map() }),
    );
  });
});

describe("toGraphViewData: making the document an unresolved target names", () => {
  const nodes = [doc("a", "Alpha"), ghost("unresolved:WIKI:nowhere", "Nowhere"), ghost("unresolved:PATH:x.md", "x.md")];
  const edges: GraphEdge[] = [{ from: "a", to: "unresolved:WIKI:nowhere", count: 1 }, { from: "a", to: "unresolved:PATH:x.md", count: 1 }];
  const sourceNames = new Map([["s1", "Notes"]]);

  it("has no way in unless it is told where to", () => {
    const data = toGraphViewData({ workspaceId: "w1", nodes, edges, sourceNames });
    expect(data.nodes.map((node) => node.createHref)).toEqual([null, null, null]);
  });

  it("gives an unresolved node the address it is told, and never a document", () => {
    const data = toGraphViewData({
      workspaceId: "w1",
      nodes,
      edges,
      sourceNames,
      createHref: (node) => (node.id === "unresolved:WIKI:nowhere" ? `/make/${node.title}` : `/should-not-be-asked-for-${node.id}`),
    });
    expect(data.nodes.map((node) => node.createHref)).toEqual([null, "/make/Nowhere", "/should-not-be-asked-for-unresolved:PATH:x.md"]);
    // A page to open is still only a document's.
    expect(data.nodes.map((node) => node.href)).toEqual(["/w/w1/knowledge/s1/a", null, null]);
  });
});

describe("adjacency", () => {
  it("links both ways", () => {
    const neighbours = adjacency([{ from: "a", to: "b", count: 1 }, { from: "c", to: "a", count: 1 }]);
    expect([...neighbours.get("a")!].sort()).toEqual(["b", "c"]);
    expect([...neighbours.get("b")!]).toEqual(["a"]);
    expect(neighbours.get("z")).toBeUndefined();
  });
});

describe("nodeLabel", () => {
  it("leaves a short title alone and shortens a long one on a code point", () => {
    expect(nodeLabel("Short")).toBe("Short");
    const shortened = nodeLabel("😀".repeat(40), 10);
    expect(Array.from(shortened)).toHaveLength(10);
    expect(shortened.endsWith("…")).toBe(true);
  });
});

describe("matchesQuery", () => {
  it("matches a title case-insensitively, and everything for an empty query", () => {
    expect(matchesQuery({ title: "Query Master" }, "master")).toBe(true);
    expect(matchesQuery({ title: "Query Master" }, "  QUERY ")).toBe(true);
    expect(matchesQuery({ title: "Query Master" }, "other")).toBe(false);
    expect(matchesQuery({ title: "Anything" }, "")).toBe(true);
    expect(matchesQuery({ title: "請假流程" }, "請假")).toBe(true);
  });
});

describe("estimateLabelWidth", () => {
  it("counts a full-width character as an em and the rest as less", () => {
    expect(estimateLabelWidth("請假流程", 10)).toBe(40);
    expect(estimateLabelWidth("abcd", 10)).toBeCloseTo(23.2, 5);
    expect(estimateLabelWidth("請假 ab", 10)).toBeGreaterThan(estimateLabelWidth("ab", 10));
    expect(estimateLabelWidth("", 10)).toBe(0);
  });
});

describe("selectVisibleLabels", () => {
  type N = Parameters<typeof selectVisibleLabels>[0][number];
  const node = (id: string, x: number, y: number, degree = 1, title = id): N => ({ id, title, x, y, radius: 4, inDegree: degree, outDegree: 0 });

  it("labels every node when there is room", () => {
    const nodes = [node("a", 0, 0), node("b", 300, 0), node("c", 0, 300)];
    expect([...selectVisibleLabels(nodes, { pxPerUnit: 1 })].sort()).toEqual(["a", "b", "c"]);
  });

  it("lets the better connected of two colliding labels have the room", () => {
    const nodes = [node("quiet", 0, 0, 1, "Quiet note"), node("hub", 6, 0, 9, "Hub note")];
    expect([...selectVisibleLabels(nodes, { pxPerUnit: 1 })]).toEqual(["hub"]);
  });

  it("does not let a label land on another node's dot", () => {
    // `b` sits right where a's label would be.
    const nodes = [node("a", 0, 0, 5, "A long enough label"), node("b", 0, 12, 1, "B")];
    expect(selectVisibleLabels(nodes, { pxPerUnit: 1 }).has("a")).toBe(false);
    expect(selectVisibleLabels(nodes, { pxPerUnit: 1 }).has("b")).toBe(true);
  });

  it("gives more labels as the reader zooms in, because each takes less of the drawing", () => {
    const nodes = Array.from({ length: 20 }, (_, index) => node(`n${index}`, (index % 5) * 40, Math.floor(index / 5) * 40, 20 - index, `Document ${index}`));
    const far = selectVisibleLabels(nodes, { pxPerUnit: 1 }).size;
    const near = selectVisibleLabels(nodes, { pxPerUnit: 4 }).size;
    expect(near).toBeGreaterThan(far);
    expect(near).toBe(20);
  });

  it("always shows the ones being looked at, even where they collide", () => {
    const nodes = [node("hub", 0, 0, 9, "Hub note"), node("looked-at", 6, 0, 0, "Looked at")];
    const shown = selectVisibleLabels(nodes, { pxPerUnit: 1, forced: new Set(["looked-at"]) });
    expect(shown.has("looked-at")).toBe(true);
    // The forced one took the room first, so the hub yields to it rather than the reverse.
    expect(shown.has("hub")).toBe(false);
  });

  it("gives boosted nodes the room before better-connected ones, without overriding a forced label", () => {
    const nodes = [node("hub", 0, 0, 9, "Hub note"), node("match", 6, 0, 0, "Match")];
    expect([...selectVisibleLabels(nodes, { pxPerUnit: 1, boosted: new Set(["match"]) })]).toEqual(["match"]);
    expect([...selectVisibleLabels(nodes, { pxPerUnit: 1, forced: new Set(["hub"]), boosted: new Set(["match"]) })]).toEqual(["hub"]);
  });

  it("stops at its limit, counting the forced ones in it", () => {
    const nodes = Array.from({ length: 30 }, (_, index) => node(`n${index}`, index * 500, 0, 30 - index));
    const shown = selectVisibleLabels(nodes, { pxPerUnit: 1, limit: 10, forced: new Set(["n29"]) });
    expect(shown.size).toBe(10);
    expect(shown.has("n29")).toBe(true);
    expect(LABEL_LIMIT).toBeGreaterThan(50);
  });

  it("never drops a forced label to keep to the limit", () => {
    const nodes = Array.from({ length: 12 }, (_, index) => node(`n${index}`, index * 500, 0));
    const forced = new Set(nodes.map((n) => n.id));
    expect(selectVisibleLabels(nodes, { pxPerUnit: 1, limit: 5, forced }).size).toBe(12);
  });

  it("gives the same answer whatever order the nodes arrive in", () => {
    const nodes = Array.from({ length: 25 }, (_, index) => node(`n${index}`, (index * 37) % 200, (index * 53) % 200, index % 4, `Note ${index}`));
    expect([...selectVisibleLabels([...nodes].reverse(), { pxPerUnit: 1.5 })].sort()).toEqual([...selectVisibleLabels(nodes, { pxPerUnit: 1.5 })].sort());
  });

  it("shows nothing at a scale that is not a scale, and nothing for no nodes", () => {
    expect(selectVisibleLabels([node("a", 0, 0)], { pxPerUnit: 0 }).size).toBe(0);
    expect(selectVisibleLabels([], { pxPerUnit: 1 }).size).toBe(0);
  });
});

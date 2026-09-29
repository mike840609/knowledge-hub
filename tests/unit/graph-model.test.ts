import { describe, expect, it } from "vitest";
import { adjacency, matchesQuery, nodeLabel, toGraphViewData } from "@/components/knowledge/graph-model";
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

import { expect, it } from "vitest";
import { neighbourhoodSelection, parseNeighbourhoodDepth } from "@/modules/knowledge/domain/agent-context";
import type { GraphNode } from "@/modules/knowledge/domain/link-graph";

const node = (id: string, kind: GraphNode["kind"] = "DOCUMENT"): GraphNode => ({ id, kind, title: id, sourceId: kind === "DOCUMENT" ? "s" : null, inDegree: 0, outDegree: 0 });

it("keeps the focus first and the graph's order", () => {
  expect(neighbourhoodSelection([node("F"), node("A"), node("B")], new Set(["F", "A", "B"]))).toEqual({ ids: ["F", "A", "B"], total: 3 });
});

it("drops unresolved and ineligible nodes", () => {
  expect(neighbourhoodSelection([node("F"), node("unresolved:x", "UNRESOLVED"), node("ARCH")], new Set(["F"]))).toEqual({ ids: ["F"], total: 1 });
});

it("caps at 20 and reports the eligible total", () => {
  const nodes = [node("focus"), ...Array.from({ length: 24 }, (_, i) => node(`d${i}`))];
  const result = neighbourhoodSelection(nodes, new Set(nodes.map(n => n.id)));
  expect(result.ids).toHaveLength(20);
  expect(result.ids[0]).toBe("focus");
  expect(result.total).toBe(25);
});

it("reads depth 2 and treats anything else as 1", () => {
  expect(parseNeighbourhoodDepth("2")).toBe(2);
  for (const raw of ["1", "3", undefined, "x", ""]) expect(parseNeighbourhoodDepth(raw)).toBe(1);
});

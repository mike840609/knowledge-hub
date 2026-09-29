import { describe, expect, it } from "vitest";
import { layoutGraph, nodeRadius, settleTicks, type LayoutEdgeInput, type LayoutNodeInput } from "@/lib/graph/layout";

const node = (id: string, inDegree = 0, outDegree = 0): LayoutNodeInput => ({ id, inDegree, outDegree });
const edge = (from: string, to: string): LayoutEdgeInput => ({ from, to });

function ring(count: number): { nodes: LayoutNodeInput[]; edges: LayoutEdgeInput[] } {
  const nodes = Array.from({ length: count }, (_, index) => node(`n${String(index).padStart(4, "0")}`, 1, 1));
  const edges = nodes.map((current, index) => edge(current.id, nodes[(index + 1) % count].id));
  return { nodes, edges };
}

describe("nodeRadius", () => {
  it("grows with degree, from a floor to a ceiling", () => {
    expect(nodeRadius(0)).toBe(4);
    expect(nodeRadius(1)).toBeGreaterThan(nodeRadius(0));
    expect(nodeRadius(9)).toBeGreaterThan(nodeRadius(4));
    expect(nodeRadius(10_000)).toBe(12);
    expect(nodeRadius(-3)).toBe(4);
  });
});

describe("settleTicks", () => {
  it("lets a small graph settle fully and stops a large one sooner, by fixed counts", () => {
    expect(settleTicks(0)).toBe(300);
    expect(settleTicks(200)).toBe(300);
    expect(settleTicks(201)).toBe(200);
    expect(settleTicks(500)).toBe(200);
    expect(settleTicks(501)).toBe(150);
    expect(settleTicks(1000)).toBe(150);
  });
});

describe("layoutGraph", () => {
  it("is empty for no nodes, and does not throw", () => {
    const layout = layoutGraph([], []);
    expect(layout.nodes).toEqual([]);
    expect(layout.width).toBeGreaterThan(0);
  });

  it("puts a single node inside the drawing", () => {
    const layout = layoutGraph([node("only")], []);
    expect(layout.nodes).toHaveLength(1);
    const [only] = layout.nodes;
    expect(Number.isFinite(only.x) && Number.isFinite(only.y)).toBe(true);
    expect(only.x).toBeGreaterThanOrEqual(only.radius);
    expect(only.x).toBeLessThanOrEqual(layout.width - only.radius);
  });

  it("gives the same coordinates every time, whatever order the input arrives in", () => {
    const { nodes, edges } = ring(40);
    const first = layoutGraph(nodes, edges);
    const again = layoutGraph(nodes, edges);
    const shuffled = layoutGraph([...nodes].reverse(), [...edges].reverse());
    expect(again).toEqual(first);
    expect(shuffled).toEqual(first);
  });

  it("returns finite coordinates inside the extent it reports, for every node", () => {
    const { nodes, edges } = ring(60);
    const layout = layoutGraph(nodes, edges);
    expect(layout.nodes).toHaveLength(60);
    for (const placed of layout.nodes) {
      expect(Number.isFinite(placed.x) && Number.isFinite(placed.y)).toBe(true);
      expect(placed.x - placed.radius).toBeGreaterThanOrEqual(-0.1);
      expect(placed.y - placed.radius).toBeGreaterThanOrEqual(-0.1);
      expect(placed.x + placed.radius).toBeLessThanOrEqual(layout.width + 0.1);
      expect(placed.y + placed.radius).toBeLessThanOrEqual(layout.height + 0.1);
    }
  });

  it("keeps nodes from sitting on top of one another", () => {
    const { nodes, edges } = ring(30);
    const layout = layoutGraph(nodes, edges);
    let closest = Infinity;
    for (let i = 0; i < layout.nodes.length; i += 1) {
      for (let j = i + 1; j < layout.nodes.length; j += 1) {
        const a = layout.nodes[i];
        const b = layout.nodes[j];
        closest = Math.min(closest, Math.hypot(a.x - b.x, a.y - b.y) - a.radius - b.radius);
      }
    }
    expect(closest).toBeGreaterThan(0);
  });

  it("draws linked nodes closer together than unlinked ones", () => {
    const layout = layoutGraph(
      [node("a", 0, 1), node("b", 1, 0), node("c"), node("d")],
      [edge("a", "b")],
    );
    const at = (id: string) => layout.nodes.find((placed) => placed.id === id)!;
    const distance = (left: string, right: string) => Math.hypot(at(left).x - at(right).x, at(left).y - at(right).y);
    expect(distance("a", "b")).toBeLessThan(distance("a", "c"));
    expect(distance("a", "b")).toBeLessThan(distance("a", "d"));
  });

  it("ignores edges to nodes that are not in the graph, and self-loops", () => {
    const layout = layoutGraph([node("a"), node("b")], [edge("a", "ghost"), edge("a", "a"), edge("ghost", "b")]);
    expect(layout.nodes.map((placed) => placed.id)).toEqual(["a", "b"]);
    expect(layout.nodes.every((placed) => Number.isFinite(placed.x))).toBe(true);
  });

  it("copes with a disconnected graph of many parts", () => {
    const nodes = Array.from({ length: 100 }, (_, index) => node(`solo${index}`));
    const layout = layoutGraph(nodes, []);
    expect(layout.nodes).toHaveLength(100);
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
  });

  it("lays out a thousand nodes within the budget the design gives it (spec §14)", () => {
    const nodes = Array.from({ length: 1000 }, (_, index) => node(`n${String(index).padStart(4, "0")}`, 3, 3));
    const edges: LayoutEdgeInput[] = [];
    for (let index = 0; index < nodes.length; index += 1) {
      edges.push(edge(nodes[index].id, nodes[(index * 7 + 1) % nodes.length].id));
      edges.push(edge(nodes[index].id, nodes[(index + 1) % nodes.length].id));
      edges.push(edge(nodes[index].id, nodes[(index * 13 + 5) % nodes.length].id));
    }
    const started = performance.now();
    const layout = layoutGraph(nodes, edges);
    const elapsed = performance.now() - started;
    expect(layout.nodes).toHaveLength(1000);
    // Measured, on a busy development container, at about two seconds for this
    // deliberately dense synthetic graph (a real link graph is sparser); the
    // assertion leaves room for a loaded CI machine, and the figure is recorded
    // in the verification note.
    expect(elapsed).toBeLessThan(6000);
    console.log(`layoutGraph(1000 nodes, 3000 edges): ${Math.round(elapsed)} ms`);
  });
});

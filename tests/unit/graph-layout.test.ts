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
    expect(nodeRadius(0)).toBe(3.5);
    expect(nodeRadius(1)).toBeGreaterThan(nodeRadius(0));
    expect(nodeRadius(9)).toBeGreaterThan(nodeRadius(4));
    expect(nodeRadius(10_000)).toBe(9);
    expect(nodeRadius(-3)).toBe(3.5);
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

  describe("the shelf of unlinked nodes", () => {
    const connected = [node("a", 0, 1), node("b", 1, 1), node("c", 1, 0)];
    const linkedEdges = [edge("a", "b"), edge("b", "c")];
    const solo = (count: number) => Array.from({ length: count }, (_, index) => node(`solo${String(index).padStart(3, "0")}`));
    const placed = (layout: ReturnType<typeof layoutGraph>, id: string) => layout.nodes.find((candidate) => candidate.id === id)!;

    it("keeps unlinked nodes out of the simulation and puts them below the connected drawing", () => {
      const layout = layoutGraph([...connected, ...solo(7)], linkedEdges);
      const lowestLinked = Math.max(...connected.map((n) => placed(layout, n.id).y + placed(layout, n.id).radius));
      for (const id of solo(7).map((n) => n.id)) expect(placed(layout, id).y).toBeGreaterThan(lowestLinked);
    });

    it("does not let them stretch the drawing: the connected part keeps the room", () => {
      const without = layoutGraph(connected, linkedEdges);
      const withShelf = layoutGraph([...connected, ...solo(30)], linkedEdges);
      // Same positions for the linked nodes, up to the shift that padding and the shelf's extent cause.
      const dx = placed(withShelf, "a").x - placed(without, "a").x;
      const dy = placed(withShelf, "a").y - placed(without, "a").y;
      for (const id of ["b", "c"]) {
        expect(placed(withShelf, id).x - placed(without, id).x).toBeCloseTo(dx, 0);
        expect(placed(withShelf, id).y - placed(without, id).y).toBeCloseTo(dy, 0);
      }
    });

    it("lays them on a grid: rows aligned, cells apart, in id order", () => {
      const layout = layoutGraph([...connected, ...solo(9)], linkedEdges);
      const shelf = solo(9).map((n) => placed(layout, n.id));
      const rows = new Map<number, number[]>();
      for (const n of shelf) rows.set(n.y, [...(rows.get(n.y) ?? []), n.x]);
      expect(rows.size).toBeGreaterThan(1);
      for (const xs of rows.values()) {
        const sorted = [...xs].sort((left, right) => left - right);
        for (let i = 1; i < sorted.length; i += 1) expect(sorted[i] - sorted[i - 1]).toBeGreaterThanOrEqual(100);
      }
      // First in id order is first in reading order.
      expect(shelf[0].y).toBeLessThanOrEqual(shelf[shelf.length - 1].y);
    });

    it("says where its caption goes, above the shelf, and only when there is a shelf", () => {
      const layout = layoutGraph([...connected, ...solo(3)], linkedEdges);
      expect(layout.unlinked).not.toBeNull();
      const top = Math.min(...solo(3).map((n) => placed(layout, n.id).y));
      expect(layout.unlinked!.y).toBeLessThan(top);
      expect(layoutGraph(connected, linkedEdges).unlinked).toBeNull();
    });

    it("is the whole drawing when nothing is linked, and still fits its extent", () => {
      const layout = layoutGraph(solo(12), []);
      expect(layout.nodes).toHaveLength(12);
      for (const n of layout.nodes) {
        expect(n.x - n.radius).toBeGreaterThanOrEqual(0);
        expect(n.y - n.radius).toBeGreaterThanOrEqual(0);
        expect(n.x + n.radius).toBeLessThanOrEqual(layout.width);
        expect(n.y + n.radius).toBeLessThanOrEqual(layout.height);
      }
    });

    it("is the same whatever order it is handed over in", () => {
      const nodes = [...connected, ...solo(11)];
      expect(layoutGraph([...nodes].reverse(), [...linkedEdges].reverse())).toEqual(layoutGraph(nodes, linkedEdges));
    });

    it("keeps the shelf about as wide as the drawing above it, not a strip across the page", () => {
      const layout = layoutGraph([...connected, ...solo(60)], linkedEdges);
      const xs = solo(60).map((n) => placed(layout, n.id).x);
      expect(Math.max(...xs) - Math.min(...xs)).toBeLessThanOrEqual(700);
    });
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

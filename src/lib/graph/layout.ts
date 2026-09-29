import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationLinkDatum, type SimulationNodeDatum } from "d3-force";

export type LayoutNodeInput = { id: string; inDegree: number; outDegree: number };
export type LayoutEdgeInput = { from: string; to: string };

export type PositionedNode = { id: string; x: number; y: number; radius: number };

export type GraphLayout = {
  nodes: PositionedNode[];
  /** The drawing's extent, padding included; its origin is (0, 0). */
  width: number;
  height: number;
};

/** Padding around the drawing, so a node at the edge is not clipped. */
const PADDING = 40;
/** Fixed: the same graph must lay out the same way every time (spec §10.2). */
const SEED = 0x6b68;

/**
 * How long to run the simulation, by size. d3's own default for settling is
 * 300 ticks, and a small graph gets that. The cost grows with the node count,
 * and a drawing of a thousand nodes does not need to be at rest to be legible,
 * so the big ones stop sooner. Fixed counts, not a time budget: a deadline
 * would make the drawing depend on how busy the machine was.
 */
export function settleTicks(nodeCount: number): number {
  if (nodeCount <= 200) return 300;
  if (nodeCount <= 500) return 200;
  return 150;
}

/** Node size grows with how connected it is, within bounds that keep a hub from swallowing its neighbours. */
export function nodeRadius(degree: number): number {
  const radius = 4 + 2 * Math.sqrt(Math.max(0, degree));
  return Math.round(Math.min(radius, 12) * 10) / 10;
}

/** A small deterministic generator (a linear congruential one) for d3's tie-breaking jiggle. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

type SimNode = SimulationNodeDatum & { id: string; radius: number };

/**
 * A force-directed layout, run to rest here on the server rather than
 * animated in the browser (spec §10.2, D7). Deterministic: nodes are put in id
 * order (d3 places nodes without a position on a spiral by index), the random
 * source that breaks ties is seeded, and the tick count is fixed — so the same
 * graph always gets the same coordinates, which is what lets the server render
 * agree with hydration, a test assert on positions, and a reader trust that
 * nothing moved because they reloaded.
 */
export function layoutGraph(nodes: readonly LayoutNodeInput[], edges: readonly LayoutEdgeInput[]): GraphLayout {
  if (nodes.length === 0) return { nodes: [], width: 2 * PADDING, height: 2 * PADDING };

  const ordered = [...nodes].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  const simNodes: SimNode[] = ordered.map((node) => ({ id: node.id, radius: nodeRadius(node.inDegree + node.outDegree) }));
  const known = new Set(simNodes.map((node) => node.id));
  // Edges too are put in a canonical order (and de-duplicated): the forces
  // accumulate in link order, so the same graph handed over in another order
  // would otherwise settle at different coordinates.
  const links: SimulationLinkDatum<SimNode>[] = [
    ...new Set(edges.filter((edge) => edge.from !== edge.to && known.has(edge.from) && known.has(edge.to)).map((edge) => `${edge.from}\0${edge.to}`)),
  ]
    .sort()
    .map((pair) => {
      const [source, target] = pair.split("\0");
      return { source, target };
    });

  const simulation = forceSimulation<SimNode>(simNodes)
    .randomSource(seededRandom(SEED))
    .force("link", forceLink<SimNode, SimulationLinkDatum<SimNode>>(links).id((node) => node.id).distance(72).strength(0.5))
    // theta 1.2: the Barnes-Hut approximation a little coarser than d3's 0.9,
    // about a quarter faster at a thousand nodes and no less settled.
    .force("charge", forceManyBody<SimNode>().strength(-220).distanceMax(500).theta(1.2))
    .force("collide", forceCollide<SimNode>((node) => node.radius + 8))
    // A weak pull towards the middle, so nodes with no links stay in view
    // instead of being pushed out to the edge by everything else.
    .force("center", forceCenter(0, 0))
    .force("x", forceX<SimNode>(0).strength(0.04))
    .force("y", forceY<SimNode>(0).strength(0.04))
    .stop();
  const ticks = settleTicks(simNodes.length);
  for (let tick = 0; tick < ticks; tick += 1) simulation.tick();

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of simNodes) {
    minX = Math.min(minX, (node.x ?? 0) - node.radius);
    minY = Math.min(minY, (node.y ?? 0) - node.radius);
    maxX = Math.max(maxX, (node.x ?? 0) + node.radius);
    maxY = Math.max(maxY, (node.y ?? 0) + node.radius);
  }
  const round = (value: number) => Math.round(value * 10) / 10;
  return {
    nodes: simNodes.map((node) => ({
      id: node.id,
      x: round((node.x ?? 0) - minX + PADDING),
      y: round((node.y ?? 0) - minY + PADDING),
      radius: node.radius,
    })),
    width: round(maxX - minX + 2 * PADDING),
    height: round(maxY - minY + 2 * PADDING),
  };
}

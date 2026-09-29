import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationLinkDatum, type SimulationNodeDatum } from "d3-force";

export type LayoutNodeInput = { id: string; inDegree: number; outDegree: number };
export type LayoutEdgeInput = { from: string; to: string };

export type PositionedNode = { id: string; x: number; y: number; radius: number };

export type GraphLayout = {
  nodes: PositionedNode[];
  /** The drawing's extent, padding included; its origin is (0, 0). */
  width: number;
  height: number;
  /**
   * Where the caption of the "not linked" shelf goes, or `null` when every node
   * is linked. The shelf is the tidy grid the unlinked nodes are put on, below
   * the connected drawing.
   */
  unlinked: { x: number; y: number } | null;
};

/** Padding around the drawing, so a node at the edge is not clipped. */
const PADDING = 40;
/** Fixed: the same graph must lay out the same way every time (spec §10.2). */
const SEED = 0x6b68;

/** Where the shelf sits: this far below the connected drawing, and each cell this big. */
const SHELF_GAP = 64;
const SHELF_CELL_WIDTH = 116;
const SHELF_CELL_HEIGHT = 34;
/** The shelf is never wider than the drawing above it, but is always allowed this much. */
const SHELF_MIN_WIDTH = 348;

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

/**
 * Node size grows with how connected it is, within bounds that keep a hub from
 * swallowing its neighbours. Small on purpose: the graph is a map, and a
 * reader finds a document by its label, not by the size of its dot.
 */
export function nodeRadius(degree: number): number {
  const radius = 3.5 + 1.5 * Math.sqrt(Math.max(0, degree));
  return Math.round(Math.min(radius, 9) * 10) / 10;
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

const round = (value: number) => Math.round(value * 10) / 10;
const byId = <T extends { id: string }>(left: T, right: T) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);

/**
 * A force-directed layout, run to rest here on the server rather than
 * animated in the browser (spec §10.2, D7). Deterministic: nodes are put in id
 * order (d3 places nodes without a position on a spiral by index), edges in a
 * canonical order, the random source that breaks ties is seeded, and the tick
 * count is fixed — so the same graph always gets the same coordinates, which is
 * what lets the server render agree with hydration, a test assert on
 * positions, and a reader trust that nothing moved because they reloaded.
 *
 * Only nodes with a link take part in the simulation. A node nothing links to
 * or from has nothing to be laid out *against*: put in the simulation it
 * drifts to wherever the repulsion of everything else leaves it, and the
 * drawing is then scaled to fit it — shrinking the part with structure to make
 * room for the part without. They are set on a tidy shelf below instead.
 */
export function layoutGraph(nodes: readonly LayoutNodeInput[], edges: readonly LayoutEdgeInput[]): GraphLayout {
  if (nodes.length === 0) return { nodes: [], width: 2 * PADDING, height: 2 * PADDING, unlinked: null };

  const ordered = [...nodes].sort(byId);
  const known = new Set(ordered.map((node) => node.id));
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
  const linked = new Set(links.flatMap((link) => [link.source as string, link.target as string]));

  const connected: SimNode[] = ordered
    .filter((node) => linked.has(node.id))
    .map((node) => ({ id: node.id, radius: nodeRadius(node.inDegree + node.outDegree) }));
  const unlinked = ordered.filter((node) => !linked.has(node.id)).map((node) => ({ id: node.id, radius: nodeRadius(0) }));

  if (connected.length > 0) {
    const simulation = forceSimulation<SimNode>(connected)
      .randomSource(seededRandom(SEED))
      // Left at d3's default strength, 1/min(degree): a leaf is held to its hub
      // firmly and a hub is not dragged about by each of them, which is what
      // makes clusters read as clusters.
      .force("link", forceLink<SimNode, SimulationLinkDatum<SimNode>>(links).id((node) => node.id).distance(54))
      // theta 1.2: the Barnes-Hut approximation a little coarser than d3's 0.9,
      // about a quarter faster at a thousand nodes and no less settled.
      .force("charge", forceManyBody<SimNode>().strength(-150).distanceMax(420).theta(1.2))
      .force("collide", forceCollide<SimNode>((node) => node.radius + 5))
      // A pull towards the middle, so separate clusters stay in one drawing
      // instead of being pushed out to its edges by each other.
      .force("center", forceCenter(0, 0))
      .force("x", forceX<SimNode>(0).strength(0.07))
      .force("y", forceY<SimNode>(0).strength(0.07))
      .stop();
    const ticks = settleTicks(connected.length);
    for (let tick = 0; tick < ticks; tick += 1) simulation.tick();
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of connected) {
    minX = Math.min(minX, (node.x ?? 0) - node.radius);
    minY = Math.min(minY, (node.y ?? 0) - node.radius);
    maxX = Math.max(maxX, (node.x ?? 0) + node.radius);
    maxY = Math.max(maxY, (node.y ?? 0) + node.radius);
  }
  if (connected.length === 0) {
    minX = 0;
    minY = 0;
    maxX = 0;
    maxY = 0;
  }

  // The shelf: a grid, centred under the drawing, no wider than it (or a
  // sensible minimum), filled row by row in id order — which for the ids this
  // product issues is creation order, so a new unlinked note joins the end.
  const placed: PositionedNode[] = [];
  let shelfCaption: { x: number; y: number } | null = null;
  if (unlinked.length > 0) {
    const available = Math.max(maxX - minX, SHELF_MIN_WIDTH);
    const columns = Math.max(1, Math.min(unlinked.length, Math.floor(available / SHELF_CELL_WIDTH), Math.ceil(Math.sqrt(unlinked.length * 2.4))));
    const rows = Math.ceil(unlinked.length / columns);
    const shelfWidth = (columns - 1) * SHELF_CELL_WIDTH;
    const centre = connected.length > 0 ? (minX + maxX) / 2 : 0;
    const top = connected.length > 0 ? maxY + SHELF_GAP : 0;
    unlinked.forEach((node, index) => {
      const row = Math.floor(index / columns);
      const column = index % columns;
      // A short last row is centred rather than left-aligned, so the shelf reads as one block.
      const inRow = row === rows - 1 ? unlinked.length - row * columns : columns;
      const rowWidth = (inRow - 1) * SHELF_CELL_WIDTH;
      placed.push({
        id: node.id,
        x: centre - rowWidth / 2 + column * SHELF_CELL_WIDTH,
        y: top + row * SHELF_CELL_HEIGHT,
        radius: node.radius,
      });
    });
    shelfCaption = { x: centre, y: top - 22 };
    const dot = nodeRadius(0);
    minX = Math.min(minX, centre - shelfWidth / 2 - dot);
    maxX = Math.max(maxX, centre + shelfWidth / 2 + dot);
    minY = connected.length > 0 ? minY : top - dot;
    maxY = Math.max(maxY, top + (rows - 1) * SHELF_CELL_HEIGHT + dot);
  }

  const positioned: PositionedNode[] = [
    ...connected.map((node) => ({ id: node.id, x: node.x ?? 0, y: node.y ?? 0, radius: node.radius })),
    ...placed,
  ];
  const origin = { x: minX - PADDING, y: minY - PADDING };
  return {
    nodes: positioned.map((node) => ({ id: node.id, x: round(node.x - origin.x), y: round(node.y - origin.y), radius: node.radius })),
    width: round(maxX - minX + 2 * PADDING),
    height: round(maxY - minY + 2 * PADDING),
    unlinked: shelfCaption ? { x: round(shelfCaption.x - origin.x), y: round(shelfCaption.y - origin.y) } : null,
  };
}

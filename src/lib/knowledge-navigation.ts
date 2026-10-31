import type {
  KnowledgeTreeItem,
  SourceView,
} from "@/modules/knowledge/application/knowledge-query-service";

export type KnowledgeTreeNode = {
  item: KnowledgeTreeItem;
  children: KnowledgeTreeNode[];
};

export function sortSourcesByName(sources: SourceView[]): SourceView[] {
  return [...sources].sort((left, right) => {
    if (left.name !== right.name) {
      return left.name < right.name ? -1 : 1;
    }
    if (left.id === right.id) return 0;
    return left.id < right.id ? -1 : 1;
  });
}

const byPosition = (
  left: KnowledgeTreeItem,
  right: KnowledgeTreeItem,
): number =>
  left.position - right.position ||
  (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);

export function buildKnowledgeTree(
  items: KnowledgeTreeItem[],
): KnowledgeTreeNode[] {
  const nodes = new Map<string, KnowledgeTreeNode>();
  for (const item of items) {
    nodes.set(item.id, { item, children: [] });
  }
  const roots: KnowledgeTreeNode[] = [];
  for (const node of nodes.values()) {
    const parentId = node.item.parentId;
    const parent = parentId === null ? undefined : nodes.get(parentId);
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sortRecursively = (list: KnowledgeTreeNode[]): void => {
    list.sort((left, right) => byPosition(left.item, right.item));
    for (const node of list) {
      if (node.children.length > 0) sortRecursively(node.children);
    }
  };
  sortRecursively(roots);
  return roots;
}

type ReadableDocument = Extract<KnowledgeTreeItem, { type: "document" }>;

export function findFirstReadableDocument(
  items: KnowledgeTreeItem[],
): ReadableDocument | undefined {
  const roots = buildKnowledgeTree(items);
  const visit = (
    list: KnowledgeTreeNode[],
  ): ReadableDocument | undefined => {
    for (const node of list) {
      if (node.item.type === "document") return node.item;
      const found = visit(node.children);
      if (found) return found;
    }
    return undefined;
  };
  return visit(roots);
}

export function filterKnowledgeTree(
  roots: KnowledgeTreeNode[],
  query: string,
): KnowledgeTreeNode[] {
  if (query.trim() === "") return roots;
  const needle = query.toLowerCase();

  const filterNode = (node: KnowledgeTreeNode): KnowledgeTreeNode | null => {
    const selfMatch = node.item.label.toLowerCase().includes(needle);
    const filteredChildren: KnowledgeTreeNode[] = [];
    for (const child of node.children) {
      const filtered = filterNode(child);
      if (filtered) filteredChildren.push(filtered);
    }
    if (selfMatch) {
      return filteredChildren.length > 0
        ? { item: node.item, children: filteredChildren }
        : { item: node.item, children: [...node.children] };
    }
    if (filteredChildren.length > 0) {
      return { item: node.item, children: filteredChildren };
    }
    return null;
  };

  const result: KnowledgeTreeNode[] = [];
  for (const root of roots) {
    const filtered = filterNode(root);
    if (filtered) result.push(filtered);
  }
  return result;
}

/** A folder a node may be moved into, in the order the tree shows it; `depth` is 0 for a folder at the top level. */
export type MoveDestination = { id: string; label: string; depth: number };

/**
 * Where a node may go: every ACTIVE folder of its source, except the node itself and everything
 * inside it (a folder cannot go into its own subtree), and except whatever is under an archived folder
 * (the server refuses a parent that is not active all the way up, so offering one would promise a move
 * that cannot happen). The top level is always there and is not in this list.
 *
 * This decides what is *offered*. The server decides what happens: a folder archived in another tab
 * since this list was made is refused there.
 */
export function moveDestinations(items: KnowledgeTreeItem[], nodeId: string): MoveDestination[] {
  const destinations: MoveDestination[] = [];
  const visit = (nodes: KnowledgeTreeNode[], depth: number): void => {
    for (const { item, children } of nodes) {
      if (item.type !== "folder" || item.status !== "ACTIVE" || item.id === nodeId) continue;
      destinations.push({ id: item.id, label: item.label, depth });
      visit(children, depth + 1);
    }
  };
  visit(buildKnowledgeTree(items), 0);
  return destinations;
}

export type ReorderStep =
  /** Put the node at `position` (an index among all its siblings); it then sits at `index` of `count` in view. */
  | { kind: "move"; position: number; index: number; count: number }
  /** Already first or last of the siblings in view: nothing to ask the server. */
  | { kind: "edge"; index: number; count: number };

function siblingsOf(nodes: KnowledgeTreeNode[], nodeId: string): KnowledgeTreeNode[] | null {
  if (nodes.some((node) => node.item.id === nodeId)) return nodes;
  for (const node of nodes) {
    const found = siblingsOf(node.children, nodeId);
    if (found) return found;
  }
  return null;
}

/**
 * One step up (`-1`) or down (`1`) among the siblings in view, as the place to ask the server for.
 *
 * The server's place is an index among *all* the siblings, archived ones included, and the tree does
 * not show those unless asked to. So the place asked for is the neighbour's own stored position, not
 * its index in view: that is where the neighbour is in the whole group, and a node put at that index
 * lands on the far side of it however many hidden siblings are in between. Stored positions are
 * contiguous within a Hub-managed group (every create and move renumbers it), which is what makes
 * that equal to an index; the test against the real service is the one that holds it to that.
 */
export function reorderStep(roots: KnowledgeTreeNode[], nodeId: string, direction: -1 | 1): ReorderStep | null {
  const siblings = siblingsOf(roots, nodeId);
  if (!siblings) return null;
  const index = siblings.findIndex((node) => node.item.id === nodeId);
  const neighbour = siblings[index + direction];
  if (!neighbour) return { kind: "edge", index, count: siblings.length };
  return { kind: "move", position: neighbour.item.position, index: index + direction, count: siblings.length };
}

export type DropZone = "before" | "after" | "into";

export type DropPlacement =
  /** Same parent: ask the server to reorder the node to `position` among all its siblings. */
  | { kind: "reorder"; position: number; index: number; count: number }
  /** Another parent: ask the server to move the node there, at `position` when there is one. */
  | { kind: "move"; parentId: string | null; position?: number; index: number; count: number };

/**
 * Where a drop asks the server to put the dragged node, or `null` when the target is not a place it
 * may go. `index` and `count` are the node's place among the *visible* siblings after the drop, for
 * the live region; `position` is the server's index among all of them, archived ones included.
 *
 * The destination is gated by `moveDestinations`, the same rule the Move dialog offers, so an
 * archived folder, an anchor under one, and the dragged folder's own subtree are all refused here
 * rather than promised and then rejected by the server. Dropping into the folder the node already
 * lives in appends it there as a same-parent reorder; into another folder the position is omitted
 * and the server appends.
 */
export function dropPlacement(
  items: KnowledgeTreeItem[],
  draggedId: string,
  targetId: string,
  zone: DropZone,
): DropPlacement | null {
  const dragged = items.find((item) => item.id === draggedId);
  const target = items.find((item) => item.id === targetId);
  if (!dragged || !target || target.id === dragged.id) return null;

  const destinations = moveDestinations(items, draggedId).map((destination) => destination.id);
  const destinationParent = zone === "into" ? target.id : target.parentId;
  if (destinationParent !== null && !destinations.includes(destinationParent)) return null;
  if (zone === "into" && target.type !== "folder") return null;

  const siblings = items
    .filter((item) => item.parentId === destinationParent && item.id !== draggedId)
    .sort(byPosition);
  const count = siblings.length + 1;

  if (zone === "into") {
    const index = siblings.length;
    return destinationParent === dragged.parentId
      ? { kind: "reorder", position: Number.MAX_SAFE_INTEGER, index, count }
      : { kind: "move", parentId: destinationParent, index, count };
  }

  const at = siblings.findIndex((item) => item.id === target.id);
  if (at < 0) return null;
  const index = zone === "before" ? at : at + 1;
  const draggedBefore = dragged.parentId === destinationParent && dragged.position < target.position;
  const position =
    zone === "before"
      ? target.position - (draggedBefore ? 1 : 0)
      : target.position + 1 - (draggedBefore ? 1 : 0);
  return destinationParent === dragged.parentId
    ? { kind: "reorder", position, index, count }
    : { kind: "move", parentId: destinationParent, position, index, count };
}

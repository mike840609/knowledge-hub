import { ValidationError } from "./errors";

export type TreeLink = {
  id: string;
  parentId: string | null;
  position: number;
};

/**
 * Pure Tree helpers (spec §7–§8). These carry no database or caller access:
 * the transaction-bound internals re-resolve every row after the Source lock
 * and only reuse these functions for in-memory validation and ordering.
 */

export function normalizeFolderName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new ValidationError("Folder name must be a non-empty string.");
  return trimmed;
}

export function normalizeTreePosition(position: number): number {
  if (!Number.isSafeInteger(position) || position < 0) {
    throw new ValidationError("Tree position must be a non-negative integer.");
  }
  return position;
}

export function wouldCreateCycle(
  nodes: TreeLink[],
  nodeId: string,
  newParentId: string | null,
): { cycle: boolean; code: "TREE_CYCLE" | null } {
  if (newParentId === null) return { cycle: false, code: null };
  if (newParentId === nodeId) return { cycle: true, code: "TREE_CYCLE" };
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const seen = new Set<string>();
  let cursor: string | null = newParentId;
  while (cursor) {
    if (cursor === nodeId) return { cycle: true, code: "TREE_CYCLE" };
    if (seen.has(cursor)) return { cycle: true, code: "TREE_CYCLE" };
    seen.add(cursor);
    cursor = byId.get(cursor)?.parentId ?? null;
  }
  return { cycle: false, code: null };
}

/**
 * Sibling order (spec §8): plain `ORDER BY position, id`. No fractional
 * indexing or LexoRank; transactions renumber the affected siblings
 * contiguously after every move/reorder.
 */
export function orderSiblingsByPosition<T extends TreeLink>(siblings: T[]): T[] {
  return [...siblings].sort((left, right) =>
    left.position === right.position
      ? (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
      : left.position - right.position,
  );
}

export function assignContiguousPositions<T extends TreeLink>(orderedSiblings: T[]): Map<string, number> {
  const positions = new Map<string, number>();
  orderedSiblings.forEach((sibling, index) => positions.set(sibling.id, index));
  return positions;
}

/**
 * Ancestor chain in root-to-parent order. Pure traversal only: the query
 * boundary (Task 8) resolves Source scope and Workspace access, so this
 * helper never crosses to another chain by itself.
 */
export function collectAncestors<T extends TreeLink>(nodes: T[], nodeId: string): T[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const chain: T[] = [];
  const seen = new Set<string>();
  let cursor = byId.get(nodeId)?.parentId ?? null;
  while (cursor) {
    if (seen.has(cursor)) break;
    seen.add(cursor);
    const parent = byId.get(cursor);
    if (!parent) break;
    chain.unshift(parent);
    cursor = parent.parentId;
  }
  return chain;
}

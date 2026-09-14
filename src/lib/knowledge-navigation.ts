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
  left: KnowledgeTreeNode,
  right: KnowledgeTreeNode,
): number =>
  left.item.position - right.item.position ||
  (left.item.id < right.item.id ? -1 : left.item.id > right.item.id ? 1 : 0);

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
    list.sort(byPosition);
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

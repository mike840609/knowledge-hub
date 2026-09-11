import Link from "next/link";
import type { KnowledgeTreeItem } from "@/modules/knowledge/application/knowledge-query-service";

type TreeNode = { item: KnowledgeTreeItem; children: TreeNode[] };

function nest(items: KnowledgeTreeItem[]): TreeNode[] {
  const nodes = new Map<string, TreeNode>();
  for (const item of items) nodes.set(item.id, { item, children: [] });
  const roots: TreeNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.item.parentId ? nodes.get(node.item.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const byPosition = (left: TreeNode, right: TreeNode) => left.item.position - right.item.position || (left.item.id < right.item.id ? -1 : 1);
  for (const node of nodes.values()) node.children.sort(byPosition);
  return roots.sort(byPosition);
}

function TreeBranch({ node, includeArchived }: { node: TreeNode; includeArchived: boolean }) {
  const { item } = node;
  if (item.type === "document") {
    const href = includeArchived && item.status === "ARCHIVED" ? `/knowledge/${item.documentId}?includeArchived=true` : `/knowledge/${item.documentId}`;
    return <li className="py-1 pl-5 text-sm"><Link className="text-slate-700 underline decoration-slate-300 underline-offset-4 hover:text-accent" href={href}>{item.label}</Link></li>;
  }
  return (
    <li className="py-1">
      <details open>
        <summary className="cursor-pointer rounded px-2 py-1 text-sm font-medium text-slate-700 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-accent">{item.label}</summary>
        {node.children.length > 0 ? <ul className="ml-3 border-l border-slate-200 pl-2">{node.children.map((child) => <TreeBranch key={child.item.id} node={child} includeArchived={includeArchived} />)}</ul> : <p className="py-2 pl-5 text-xs text-slate-400">No documents yet.</p>}
      </details>
    </li>
  );
}

export function KnowledgeTree({ items, includeArchived = false }: { items: KnowledgeTreeItem[]; includeArchived?: boolean }) {
  const roots = nest(items);
  return roots.length > 0 ? <ul className="space-y-1">{roots.map((node) => <TreeBranch key={node.item.id} node={node} includeArchived={includeArchived} />)}</ul> : <p className="text-sm text-slate-500">This source has no active tree nodes.</p>;
}

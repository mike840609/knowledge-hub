import Link from "next/link";
import type { TreeItem } from "@/modules/knowledge/application/service";

function TreeBranch({ item }: { item: TreeItem }) {
  if (item.nodeType === "DOCUMENT") {
    return <li className="py-1 pl-5 text-sm"><Link className="text-slate-700 underline decoration-slate-300 underline-offset-4 hover:text-accent" href={`/knowledge/${item.documentId}`}>{item.name}</Link></li>;
  }
  return (
    <li className="py-1">
      <details open>
        <summary className="cursor-pointer rounded px-2 py-1 text-sm font-medium text-slate-700 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-accent">{item.name}</summary>
        {item.children.length > 0 ? <ul className="ml-3 border-l border-slate-200 pl-2">{item.children.map((child) => <TreeBranch key={child.id} item={child} />)}</ul> : <p className="py-2 pl-5 text-xs text-slate-400">No documents yet.</p>}
      </details>
    </li>
  );
}

export function KnowledgeTree({ items }: { items: TreeItem[] }) {
  return items.length > 0 ? <ul className="space-y-1">{items.map((item) => <TreeBranch key={item.id} item={item} />)}</ul> : <p className="text-sm text-slate-500">This source has no active tree nodes.</p>;
}

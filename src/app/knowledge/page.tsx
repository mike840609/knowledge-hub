import Link from "next/link";
import { applicationServices } from "@/server/composition";
import { getCurrentIdentity } from "@/modules/identity/application/get-current-identity";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import { CreateDocumentForm, type FolderOption } from "@/components/knowledge/create-document-form";
import { KnowledgeTree } from "@/components/knowledge/knowledge-tree";
import type { KnowledgeTreeItem } from "@/modules/knowledge/application/knowledge-query-service";

export const dynamic = "force-dynamic";

function folderOptions(items: KnowledgeTreeItem[], prefix: string[] = []): FolderOption[] {
  const byParent = new Map<string | null, KnowledgeTreeItem[]>();
  for (const item of items) {
    const siblings = byParent.get(item.parentId) ?? [];
    siblings.push(item);
    byParent.set(item.parentId, siblings);
  }
  const collect = (parentId: string | null, trail: string[]): FolderOption[] =>
    (byParent.get(parentId) ?? []).flatMap((item) => item.type === "folder"
      ? [{ id: item.id, label: [...trail, item.label].join(" / ") }, ...collect(item.id, [...trail, item.label])]
      : []);
  return collect(null, prefix);
}

export default async function KnowledgePage({ searchParams }: { searchParams?: Promise<{ workspaceId?: string }> }) {
  const services = applicationServices();
  const identity = await getCurrentIdentity(services.identityProvider);
  const caller = callerFromIdentity(identity);
  const workspaces = await services.workspaces.listWorkspaces(caller);
  const requestedWorkspaceId = (await searchParams)?.workspaceId;
  const selectedWorkspaceId = workspaces.some((workspace) => workspace.id === requestedWorkspaceId) ? requestedWorkspaceId : workspaces[0]?.id;
  const sources = selectedWorkspaceId ? await services.queries.listSources(caller, selectedWorkspaceId) : [];
  const sourceTrees = await Promise.all(sources.map(async (source) => ({ source, tree: await services.queries.listTree(caller, source.id) })));
  return (
    <main className="mx-auto min-h-screen max-w-6xl px-6 py-10">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-6">
        <div><Link className="text-sm font-semibold text-accent" href="/">TSMC Knowledge Hub</Link><h1 className="mt-3 text-4xl font-semibold tracking-tight text-ink">Knowledge</h1></div>
        <div className="text-right text-sm text-slate-500"><p>{identity.name} · {identity.emp_id}</p><p>Organization: {identity.org_code}</p></div>
      </header>
      <section aria-labelledby="workspace-heading" className="mt-8 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 id="workspace-heading" className="text-lg font-semibold text-ink">Workspace</h2>
        {workspaces.length > 0 ? <form className="mt-3 flex flex-wrap items-end gap-3" method="get"><div className="min-w-64"><label className="block text-sm font-medium text-slate-700" htmlFor="workspace-selector">Choose a workspace</label><select id="workspace-selector" name="workspaceId" defaultValue={selectedWorkspaceId} className="mt-1 min-h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm">{workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select></div><button className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white" type="submit">Open</button></form> : <p className="mt-2 text-sm text-slate-500">You are not a member of any workspace.</p>}
      </section>
      <div className="mt-8 grid gap-8 lg:grid-cols-[1.2fr_0.8fr]">
        <section className="space-y-6" aria-labelledby="tree-heading">
          <div><h2 id="tree-heading" className="text-xl font-semibold text-ink">Your source tree</h2><p className="mt-1 text-sm text-slate-500">Browse active sources, folders, and documents in the selected workspace.</p></div>
          {sourceTrees.length === 0 ? <p className="rounded-xl border border-dashed border-slate-300 p-6 text-sm text-slate-500">No active sources are available yet.</p> : sourceTrees.map(({ source, tree }) => <section key={source.id} aria-labelledby={`source-${source.id}`} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between gap-3"><div><h3 id={`source-${source.id}`} className="font-semibold text-ink">{source.name}</h3><p className="text-xs text-slate-500">{source.ownership === "SOURCE_MANAGED" ? "來源同步 · 唯讀" : "Hub 管理"}</p></div><span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">{source.status}</span></div><div className="mt-4"><KnowledgeTree items={tree} /></div></section>)}
        </section>
        <section aria-labelledby="create-heading"><h2 id="create-heading" className="text-xl font-semibold text-ink">Create a Hub document</h2><p className="mt-1 mb-4 text-sm text-slate-500">Add a document to an active folder in a Hub-managed source.</p>{sourceTrees.filter(({ source }) => source.ownership === "HUB_MANAGED").map(({ source, tree }) => <div key={source.id} className="mb-6"><h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">{source.name}</h3><CreateDocumentForm sourceId={source.id} sourceName={source.name} folders={folderOptions(tree)} /></div>)}</section>
      </div>
    </main>
  );
}

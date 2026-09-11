import Link from "next/link";
import { KnowledgeTree } from "@/components/knowledge/knowledge-tree";
import { SourceSelector } from "@/components/knowledge/source-selector";
import { WorkspaceSelector } from "@/components/knowledge/workspace-selector";
import { getKnowledgeBrowserModel } from "@/server/knowledge-read";

export const dynamic = "force-dynamic";

type BrowserSearchParams = { workspaceId?: string; sourceId?: string; includeArchived?: string };

export default async function KnowledgePage({ searchParams }: { searchParams?: Promise<BrowserSearchParams> }) {
  const params = (await searchParams) ?? {};
  const model = await getKnowledgeBrowserModel({
    workspaceId: params.workspaceId,
    sourceId: params.sourceId || undefined,
    includeArchived: params.includeArchived === "true",
  });
  return (
    <main className="mx-auto min-h-screen max-w-6xl px-6 py-10">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-6">
        <div><Link className="text-sm font-semibold text-accent" href="/">TSMC Knowledge Hub</Link><h1 className="mt-3 text-4xl font-semibold tracking-tight text-ink">Knowledge</h1></div>
        <div className="text-right text-sm text-slate-500"><p>{model.identityName} · {model.identityEmpId}</p><p>Organization: {model.identityOrg}</p></div>
      </header>
      <section aria-labelledby="workspace-heading" className="mt-8 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 id="workspace-heading" className="text-lg font-semibold text-ink">Workspace</h2>
        {model.workspaces.length > 0 ? (
          <form className="mt-3 flex flex-wrap items-end gap-3" method="get">
            <WorkspaceSelector workspaces={model.workspaces} selectedWorkspaceId={model.selectedWorkspaceId} />
            <SourceSelector sources={model.sources} selectedSourceId={model.selectedSourceId} />
            <div className="flex min-h-10 items-center gap-2">
              <input id="archived-toggle" name="includeArchived" type="checkbox" value="true" defaultChecked={model.includeArchived} className="h-4 w-4" />
              <label className="text-sm font-medium text-slate-700" htmlFor="archived-toggle">Include archived</label>
            </div>
            <button className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white" type="submit">Apply</button>
          </form>
        ) : <p className="mt-2 text-sm text-slate-500">You are not a member of any workspace.</p>}
      </section>
      <section className="mt-8 space-y-6" aria-labelledby="tree-heading">
        <div><h2 id="tree-heading" className="text-xl font-semibold text-ink">Your source tree</h2><p className="mt-1 text-sm text-slate-500">Browse active sources, folders, and documents in the selected workspace.</p></div>
        {model.sourceTrees.length === 0 ? <p className="rounded-xl border border-dashed border-slate-300 p-6 text-sm text-slate-500">No active sources are available yet.</p> : model.sourceTrees.map(({ source, tree }) => <section key={source.id} aria-labelledby={`source-${source.id}`} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between gap-3"><div><h3 id={`source-${source.id}`} className="font-semibold text-ink">{source.name}</h3><p className="text-xs text-slate-500">{source.ownership === "SOURCE_MANAGED" ? "來源同步 · 唯讀" : "Hub 管理"}</p></div><span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">{source.status}</span></div><div className="mt-4"><KnowledgeTree items={tree} includeArchived={model.includeArchived} /></div></section>)}
      </section>
    </main>
  );
}

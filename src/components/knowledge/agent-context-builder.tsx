"use client";

import { FileText, Search } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { WorkspaceContentActions } from "./workspace-content-actions";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { navigateListRows } from "@/lib/list-row-navigation";
export type ContextChoice = { documentId: string; sourceId: string; title: string; sourceName: string; sourcePath: string | null };
export function AgentContextBuilder({ workspaceId, documents, initialDocumentId }: { workspaceId: string; documents: ContextChoice[]; initialDocumentId?: string }) {
  const [selected, setSelected] = useState<string[]>(() => documents.some(d => d.documentId === initialDocumentId) ? [initialDocumentId!] : []);
  const [query, setQuery] = useState("");
  const [bundle, setBundle] = useState<{ markdown: string; bytes: number; documentCount: number } | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const preview = useRef<HTMLDivElement>(null);
  const toast = useToast();
  useEffect(() => () => controller.current?.abort(), []);
  function clearSelection() {
    controller.current?.abort(); setBusy(false); setSelected([]); setBundle(null); setError(null);
  }
  function toggle(id: string) {
    controller.current?.abort(); setBusy(false); setBundle(null); setError(null);
    setSelected(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]);
  }
  async function generate() {
    controller.current?.abort(); const active = new AbortController(); controller.current = active;
    setBusy(true); setBundle(null); setError(null);
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/agent-context`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ documentIds: selected }), signal: active.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message ?? "Could not prepare context.");
      if (!active.signal.aborted) setBundle(data);
    } catch (e) { if (!active.signal.aborted) setError(e instanceof Error ? e.message : "Could not prepare context."); }
    finally { if (controller.current === active) setBusy(false); }
  }
  async function copy() {
    if (!bundle) return;
    try { await navigator.clipboard.writeText(bundle.markdown); setError(null); toast({ message: "Context copied." }); }
    catch { const field = preview.current?.querySelector("textarea"); field?.focus(); field?.select(); setError("Clipboard access is unavailable. The preview is selected; copy it manually."); }
  }
  const normalized = query.trim().toLocaleLowerCase();
  const matches = documents.filter(d => [d.title, d.sourceName, d.sourcePath].some(value => value?.toLocaleLowerCase().includes(normalized)));
  const visible = matches.slice(0, 100);
  if (!documents.length) return <EmptyState icon={FileText} title="Add documents to prepare AI context" description="Turn saved documents into Markdown your AI agent can use. Import a folder or create a note, then select documents and prepare a preview." action={<WorkspaceContentActions workspaceId={workspaceId} />} />;
  return <div className="space-y-4">
    <p className="text-body text-kh-text-secondary">Select up to 20 saved documents to prepare Markdown for your Agent. Maximum 256 KiB. Review the content before copying.</p>
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
    <section aria-label="Available documents" className="min-w-0 space-y-3">
    <label htmlFor="context-search" className="block text-caption text-kh-text-muted">Find documents<Input id="context-search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Title, source or path" className="mt-1" /></label>
    <p className="text-caption text-kh-text-muted">{selected.length} selected · {matches.length} matching documents{matches.length > 100 ? " · showing the first 100; narrow your search" : ""}</p>

    <ul aria-label="Documents for Agent" className="max-h-[28rem] space-y-0.5 overflow-y-auto overscroll-contain" onKeyDown={navigateListRows}>
      {visible.map(d => <li key={d.documentId} className="flex items-center gap-3 rounded-md px-3 py-2 hover:bg-kh-bg-hover">
        <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-body">
          <input type="checkbox" className="kh-focus-ring accent-kh-primary" aria-label={`Select ${d.title} · ${d.sourceName}${d.sourcePath ? ` · ${d.sourcePath}` : ""}`} checked={selected.includes(d.documentId)} disabled={busy || (!selected.includes(d.documentId) && selected.length >= 20)} onChange={() => toggle(d.documentId)} />
          <span className="min-w-0"><span className="block truncate text-kh-text">{d.title}</span><span className="block truncate text-caption text-kh-text-muted">{[d.sourceName, d.sourcePath].filter(Boolean).join(" · ")}</span></span>
        </label>
        <Link data-list-row className="kh-focus-ring rounded-md text-caption text-kh-link" href={`/w/${workspaceId}/knowledge/${d.sourceId}/${d.documentId}`}>Read</Link>
      </li>)}
    </ul>
    {!matches.length ? <EmptyState icon={Search} title="No matching documents." description="Try another title, source or path. Clearing this search keeps your selected documents." action={<Button variant="secondary" onClick={() => setQuery("")}>Clear search</Button>} /> : null}
    </section>
    <aside aria-label="Selected documents" className="min-w-0 space-y-3 border-t border-kh-border pt-3 lg:sticky lg:top-4 lg:border-t-0 lg:border-l lg:pl-4 lg:pt-0">
      <h2 className="text-body font-medium">Selected documents <span className="text-kh-text-muted">{selected.length} / 20</span></h2>
      {!selected.length ? <p className="text-caption text-kh-text-muted">Select documents from the list, choose Prepare context, then review the preview before copying it to your agent. Your selections stay here when you search.</p> : <ul className="max-h-[20rem] divide-y divide-kh-border overflow-y-auto">{selected.map(id => { const d = documents.find(d => d.documentId === id) ?? {title:"Unavailable document",sourceName:"",sourcePath:null}; return <li key={id} className="flex items-start gap-2 py-2"><div className="min-w-0 flex-1"><p className="truncate text-body-sm" title={d.title}>{d.title}</p><p className="truncate text-caption text-kh-text-muted" title={[d.sourceName,d.sourcePath].filter(Boolean).join(" · ")}>{[d.sourceName,d.sourcePath].filter(Boolean).join(" · ")}</p>{!visible.some(row => row.documentId === id) ? <span className="text-micro text-kh-text-muted">Outside current results</span> : null}</div><Button variant="ghost" size="sm" disabled={busy} aria-label={`Remove ${d.title} from selection`} onClick={() => toggle(id)}>Remove</Button></li>; })}</ul>}
      <div className="flex flex-wrap items-center gap-2"><Button onClick={() => void generate()} disabled={busy || !selected.length}>{busy ? "Preparing…" : "Prepare context"}</Button><Button variant="ghost" size="sm" disabled={busy || !selected.length} onClick={clearSelection}>Clear selection</Button>{bundle ? <Button variant="secondary" onClick={() => void copy()}>Copy for Agent</Button> : null}</div>
    </aside>
    </div>
    {error ? <p role="alert" className="text-body text-kh-danger">{error}</p> : null}
    {bundle ? <section aria-label="Context preview" className="space-y-2"><p className="text-caption text-kh-text-muted">{bundle.documentCount} documents · {bundle.bytes.toLocaleString()} bytes · saved revisions only</p><label htmlFor="agent-context-preview" className="block text-body">Markdown preview</label><div ref={preview}><Textarea id="agent-context-preview" value={bundle.markdown} readOnly rows={16} /></div></section> : null}
  </div>;
}

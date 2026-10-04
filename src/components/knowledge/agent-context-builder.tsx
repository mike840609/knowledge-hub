"use client";
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
  return <div className="space-y-4">
    <p className="text-body text-kh-text-secondary">Select up to 20 saved documents to prepare Markdown for your Agent. Maximum 256 KiB. Review the content before copying.</p>
    <label htmlFor="context-search" className="block text-caption text-kh-text-muted">Find documents<Input id="context-search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Title, source or path" className="mt-1" /></label>
    <p className="text-caption text-kh-text-muted">{selected.length} selected · {matches.length} matching documents{matches.length > 100 ? " · showing the first 100; narrow your search" : ""}</p>
    {selected.some(id => !visible.some(d => d.documentId === id)) ? <p className="text-caption text-kh-text-muted">Some selections are outside this view. They remain included.</p> : null}
    <ul aria-label="Documents for Agent" className="space-y-0.5" onKeyDown={navigateListRows}>
      {visible.map(d => <li key={d.documentId} className="flex items-center gap-3 rounded-md px-3 py-2 hover:bg-kh-bg-hover">
        <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-body">
          <input type="checkbox" className="kh-focus-ring accent-kh-primary" aria-label={`Select ${d.title} · ${d.sourceName}${d.sourcePath ? ` · ${d.sourcePath}` : ""}`} checked={selected.includes(d.documentId)} disabled={busy || (!selected.includes(d.documentId) && selected.length >= 20)} onChange={() => toggle(d.documentId)} />
          <span className="min-w-0"><span className="block truncate text-kh-text">{d.title}</span><span className="block truncate text-caption text-kh-text-muted">{[d.sourceName, d.sourcePath].filter(Boolean).join(" · ")}</span></span>
        </label>
        <Link data-list-row className="kh-focus-ring rounded-md text-caption text-kh-link" href={`/w/${workspaceId}/knowledge/${d.sourceId}/${d.documentId}`}>Read</Link>
      </li>)}
    </ul>
    {!matches.length ? <p className="text-body text-kh-text-muted">No matching documents.</p> : null}
    <div className="flex flex-wrap items-center gap-3"><Button onClick={() => void generate()} disabled={busy || !selected.length}>{busy ? "Preparing…" : "Prepare context"}</Button><Button variant="secondary" disabled={busy || !selected.length} onClick={() => { setSelected([]); setBundle(null); setError(null); }}>Clear selection</Button>{bundle ? <Button variant="secondary" onClick={() => void copy()}>Copy for Agent</Button> : null}</div>
    {error ? <p role="alert" className="text-body text-kh-danger">{error}</p> : null}
    {bundle ? <section aria-label="Context preview" className="space-y-2"><p className="text-caption text-kh-text-muted">{bundle.documentCount} documents · {bundle.bytes.toLocaleString()} bytes · saved revisions only</p><label htmlFor="agent-context-preview" className="block text-body">Markdown preview</label><div ref={preview}><Textarea id="agent-context-preview" value={bundle.markdown} readOnly rows={16} /></div></section> : null}
  </div>;
}

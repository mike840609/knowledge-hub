"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { savedSearchHref, type SavedSearch, type SavedSearchFilters } from "@/lib/saved-searches";
type State = { version: number; searches: SavedSearch[] };
export function SavedSearches({ workspaceId }: { workspaceId: string }) {
  const params = useSearchParams();
  const [state, setState] = useState<State | null>(null);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const endpoint = `/api/workspaces/${encodeURIComponent(workspaceId)}/saved-searches`;
  useEffect(() => {
    let active = true;
    setState(null); setError("");
    fetch(endpoint, { cache: "no-store" }).then(async r => {
      if (!r.ok) throw new Error("Unable to load saved searches.");
      const loaded = await r.json();
      if (active) setState(loaded);
    }).catch(() => { if(active) setError("Unable to load saved searches. Reload to try again."); });
    return () => { active = false; };
  }, [endpoint]);
  async function update(searches: SavedSearch[], message: string) {
    if (!state || busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(endpoint, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: state.version, searches }) });
      if (response.status === 409) {
        const latest = await fetch(endpoint, { cache: "no-store" });
        if (!latest.ok) throw new Error("Saved searches changed. Reload before trying again.");
        setState(await latest.json());
        throw new Error("Saved searches changed in another session. Latest searches loaded; review and try again.");
      }
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Unable to save searches.");
      setState(body); setName(""); setEditing(null); toast({ message });
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to save searches."); }
    finally { setBusy(false); }
  }
  function save() {
    if (!state) return;
    if (!name.trim() || name.length > 80) { setError("Enter a name of up to 80 characters."); return; }
    if(editing) { void update(state.searches.map(s => s.id === editing ? {...s, name: name.trim()} : s), "Saved search renamed."); return; }
    const filters: SavedSearchFilters = { q: params.get("q") ?? "", scope: params.get("scope") === "all" ? "all" : "workspace", source: params.get("scope") === "all" ? "" : params.get("source") ?? "", path: params.get("path") ?? "", from: params.get("from") ?? "", to: params.get("to") ?? "", offset: params.get("offset") ?? "0", sort: params.get("sort") ?? "relevance", archived: params.get("archived") === "1" };
    void update([...state.searches, { id: crypto.randomUUID(), name: name.trim(), filters }], "Search saved.");
  }
  if (!state) return error ? <p role="alert" className="mt-3 text-body-sm text-kh-danger">{error}</p> : null;
  return <section aria-label="Saved searches" className="mt-3 border-b border-kh-border pb-3">
    <details><summary className="kh-focus-ring w-fit cursor-pointer rounded-md text-body-sm text-kh-text-secondary">Saved searches · {state.searches.length}/20 · Personal</summary>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Input aria-label="Saved search name" maxLength={80} value={name} onChange={e => setName(e.target.value)} placeholder="Name this search" disabled={busy} className="min-w-0 max-w-64 flex-1" />
        <Button variant="secondary" disabled={busy || (!editing && state.searches.length >= 20)} onClick={save}>{editing ? "Rename search" : "Save current search"}</Button>
        {editing && <Button variant="ghost" disabled={busy} onClick={() => {setEditing(null); setName("");}}>Cancel</Button>}
      </div>
      {state.searches.length === 0 && <p className="mt-2 text-caption text-kh-text-muted">Save a query and its filters to reopen it here.</p>}
      <ul className="mt-2 space-y-1">{state.searches.map(search => <li key={search.id} className="flex flex-wrap items-center gap-2">
        <Link href={savedSearchHref(workspaceId, search.filters)} className="kh-focus-ring min-w-0 flex-1 rounded-md text-body-sm text-kh-link break-words">{search.name}</Link>
        <Button variant="ghost" disabled={busy} aria-label={`Rename ${search.name}`} onClick={() => {setEditing(search.id); setName(search.name);}}>Rename</Button>
        <Button variant="ghost" disabled={busy} aria-label={`Delete ${search.name}`} onClick={() => void update(state.searches.filter(s => s.id !== search.id), "Saved search deleted.")}>Delete</Button>
      </li>)}</ul>
    </details>
    {error && <p role="alert" className="mt-2 text-body-sm text-kh-danger">{error}</p>}
  </section>;
}

"use client";
import Link from "next/link";
import { navigateListRows } from "@/lib/list-row-navigation";
import { useDocumentShortcuts, documentShortcutKey } from "./use-document-shortcuts";
import { toggleFavoriteDocument } from "@/lib/document-shortcuts";
import { Button, buttonClasses } from "@/components/ui/button";
import { PageHeader } from "@/components/shell/page-header";
import { Timestamp } from "@/components/ui/timestamp";
import { useHydrated } from "@/components/shell/use-hydrated";
type Doc = { documentId: string; sourceId: string; title: string; updatedAt: string };
export function PersonalHome({ workspaceId, documents, drafts }: { workspaceId: string; documents: Doc[]; drafts: { key: string; title: string; sourceId: string | null; updatedAt: string }[] }) {
  const { shortcuts, update } = useDocumentShortcuts(workspaceId); const hydrated = useHydrated();
  const favorites = documents.filter(d => shortcuts.favorites.includes(documentShortcutKey(d.sourceId, d.documentId)));
  const recent = shortcuts.recent.map(key => documents.find(d => documentShortcutKey(d.sourceId, d.documentId) === key)).filter((d): d is Doc => !!d);
  function rows(docs: Doc[]) {
    return <ul className="mt-2" onKeyDown={navigateListRows}>{docs.map(d => {
      const key = documentShortcutKey(d.sourceId, d.documentId); const favorite = shortcuts.favorites.includes(key);
      return <li key={key} className="flex items-center gap-2 border-b border-kh-border py-2"><Link data-list-row className="kh-focus-ring min-w-0 flex-1 truncate text-body text-kh-link" href={`/w/${workspaceId}/knowledge/${d.sourceId}/${d.documentId}`}>{d.title}</Link><span className="text-caption text-kh-text-muted"><Timestamp value={d.updatedAt} /></span><Button variant="ghost" disabled={!hydrated} onClick={() => update(s => toggleFavoriteDocument(s, key))} aria-label={`${favorite ? "Remove favorite" : "Favorite"}: ${d.title}`}>{favorite ? "★" : "☆"}</Button></li>;
    })}</ul>;
  }
  return <div className="kh-page py-6 space-y-6">
    <PageHeader location="My Space" locationHref={`/w/${workspaceId}/home`} title="Home" description="Continue writing, revisit a favorite, or start a note." actions={<Link className={buttonClasses()} href={`/w/${workspaceId}/knowledge/new`}>New note</Link>} />
    <div className="flex flex-wrap gap-3"><Link className={buttonClasses({ variant: "secondary" })} href={`/w/${workspaceId}/knowledge`}>Organize documents</Link><a className={buttonClasses({ variant: "secondary" })} href={`/api/workspaces/${workspaceId}/export`}>Export Markdown ZIP</a></div>
    <p className="text-caption text-kh-text-muted">Export includes saved documents and archived notes. Drafts, revision history and attachment files are excluded.</p>
    <section><h2 className="text-title font-medium">Drafts</h2>{drafts.length ? <ul className="mt-2" onKeyDown={navigateListRows}>{drafts.map(d => <li key={d.key} className="border-b border-kh-border py-2"><Link data-list-row className="kh-focus-ring text-body text-kh-link" href={d.key === "draft:new" ? `/w/${workspaceId}/knowledge/new` : `/w/${workspaceId}/knowledge/${d.sourceId}/${d.key.split(":")[1]}/edit`}>{d.title || "Untitled draft"}</Link><span className="ml-3 text-caption text-kh-text-muted"><Timestamp value={d.updatedAt} /></span></li>)}</ul> : <p className="mt-2 text-body text-kh-text-muted">No unfinished drafts.</p>}</section>
    {recent.length > 0 && <section><h2 className="text-title font-medium">Continue reading</h2>{rows(recent.slice(0, 4))}</section>}
    <section><h2 className="text-title font-medium">Favorites</h2>{favorites.length ? rows(favorites) : <p className="mt-2 text-body text-kh-text-muted">Star a document to keep it here across devices.</p>}</section>
    <section><h2 className="text-title font-medium">Recently edited</h2>{documents.length ? rows(documents.slice(0, 12)) : <p className="mt-2 text-body text-kh-text-muted">Create your first note or <Link className="text-kh-link underline" href={`/w/${workspaceId}/sources/import`}>import a folder</Link>.</p>}</section>
  </div>;
}

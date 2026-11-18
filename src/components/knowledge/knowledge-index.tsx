"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { SelectMenu } from "@/components/ui/select-menu";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { navigateListRows } from "@/lib/list-row-navigation";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Timestamp } from "@/components/ui/timestamp";

export type KnowledgeIndexRow = {
  documentId: string;
  sourceId: string;
  sourceName: string;
  title: string;
  updatedAt: string;
  inDegree: number;
  outDegree: number;
  href: string;
  pageIcon?: string | null;
};

type SortKey = "updated" | "title" | "inDegree" | "outDegree";

const PAGE_SIZES = [25, 50, 100] as const;
const DEFAULT_PAGE_SIZE = 50;

const SORTS: readonly { value: SortKey; label: string }[] = [
  { value: "updated", label: "Recently updated" },
  { value: "title", label: "Title" },
  { value: "inDegree", label: "Most linked to" },
  { value: "outDegree", label: "Most links out" },
];

/**
 * The whole library in one place: every active document with its source,
 * updated time, and how many links come in and go out. The document pane's
 * tree answers "where am I"; this answers "what do I have".
 */
export function KnowledgeIndex({
  rows,
  sources,
  initialQuery = "",
  initialSource = "",
  initialSort = "updated",
  initialAscending = false,
  initialPage = 1,
  initialPageSize = DEFAULT_PAGE_SIZE,
}: {
  rows: readonly KnowledgeIndexRow[];
  sources: readonly { id: string; name: string }[];
  initialQuery?: string;
  initialSource?: string;
  initialSort?: SortKey;
  initialAscending?: boolean;
  initialPage?: number;
  initialPageSize?: number;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [sourceId, setSourceId] = useState(initialSource);
  const [sort, setSort] = useState<{ key: SortKey; ascending: boolean }>({ key: initialSort, ascending: initialAscending });
  const [page, setPage] = useState(initialPage);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const router = useRouter();
  const toast = useToast();
  const tableRef = useRef<HTMLDivElement>(null);
  const firstFilterRender = useRef(true);
  useEffect(() => {
    // Keep a deep-linked page; only a filter or sort the reader changes starts again at 1.
    if (firstFilterRender.current) { firstFilterRender.current = false; return; }
    setPage(1);
  }, [query, sourceId, sort, pageSize]);
  useEffect(() => {
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (sourceId) params.set("source", sourceId);
    if (sort.key !== "updated" || sort.ascending) {
      params.set("sort", sort.key);
      if (sort.ascending) params.set("dir", "asc");
    }
    if (pageSize !== DEFAULT_PAGE_SIZE) params.set("per", String(pageSize));
    if (page > 1) params.set("page", String(page));
    const search = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${search ? `?${search}` : ""}`);
  }, [query, sourceId, sort, page, pageSize]);
  useEffect(() => { if (page > 1) tableRef.current?.scrollIntoView({ block: "start" }); }, [page]);

  const shown = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const filtered = rows.filter((row) => {
      if (sourceId && row.sourceId !== sourceId) return false;
      if (!needle) return true;
      return row.title.toLocaleLowerCase().includes(needle) || row.sourceName.toLocaleLowerCase().includes(needle);
    });
    return filtered.sort((left, right) => {
      const delta = sort.key === "updated"
        ? Date.parse(left.updatedAt) - Date.parse(right.updatedAt)
        : sort.key === "title"
          ? left.title.localeCompare(right.title)
          : left[sort.key] - right[sort.key];
      return (sort.ascending ? delta : -delta) || left.documentId.localeCompare(right.documentId);
    });
  }, [rows, query, sourceId, sort]);

  const order = (key: SortKey) => setSort((current) => ({ key, ascending: current.key === key ? !current.ascending : key === "title" }));
  const pageCount = Math.max(1, Math.ceil(shown.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visible = shown.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const allVisibleSelected = visible.length > 0 && visible.every((row) => selected.has(row.documentId));
  const toggleAll = () => setSelected((current) => {
    const next = new Set(current);
    if (allVisibleSelected) visible.forEach((row) => next.delete(row.documentId));
    else visible.forEach((row) => next.add(row.documentId));
    return next;
  });
  const toggleOne = (documentId: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(documentId)) next.delete(documentId); else next.add(documentId);
    return next;
  });
  const archiveSelected = async () => {
    const ids = [...selected];
    await Promise.all(ids.map((id) => fetch(`/api/documents/${id}/archive`, { method: "POST" }).catch(() => null)));
    setSelected(new Set());
    router.refresh();
    toast({
      message: `Archived ${ids.length} ${ids.length === 1 ? "document" : "documents"}.`,
      undo: {
        run: async () => {
          await Promise.all(ids.map((id) => fetch(`/api/documents/${id}/restore`, { method: "POST" }).catch(() => null)));
          router.refresh();
        },
      },
    });
  };
  const heading = (key: SortKey, label: string, align = "", extra = "") => (
    <th scope="col" aria-sort={sort.key === key ? (sort.ascending ? "ascending" : "descending") : "none"} className={`border-b border-kh-border bg-kh-bg px-3 py-2 font-medium ${align} ${extra}`}>
      <button type="button" className={`kh-focus-ring inline-flex min-h-6 items-center gap-1 whitespace-nowrap rounded-md ${align === "text-right" ? "justify-end" : ""}`} onClick={() => order(key)}>
        {label}{sort.key === key ? (sort.ascending ? <ArrowUp size={12} aria-hidden="true" /> : <ArrowDown size={12} aria-hidden="true" />) : null}
      </button>
    </th>
  );

  return <div>
    <div className="flex flex-col gap-2 border-b border-kh-border bg-kh-bg py-2 sm:sticky sm:top-0 sm:z-20 sm:flex-row sm:items-center">
      <div className="relative min-w-0 sm:max-w-md sm:flex-1">
        <label htmlFor="knowledge-find" className="sr-only">Find a document</label>
        <Search size={15} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-kh-text-muted" />
        <Input id="knowledge-find" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a document" className="kh-search-field pl-9" />
      </div>
      {sources.length > 1 ? <div className="sm:w-48">
        <SelectMenu aria-label="Filter by source" value={sourceId} onValueChange={setSourceId} options={[{ value: "", label: "All sources" }, ...sources.map((source) => ({ value: source.id, label: source.name }))]} />
      </div> : null}
      <div className="sm:w-48">
        <SelectMenu aria-label="Sort documents" value={sort.key} onValueChange={(value) => setSort({ key: value as SortKey, ascending: value === "title" })} options={SORTS} />
      </div>
      <p role="status" className="text-caption tabular-nums text-kh-text-muted sm:ml-auto">
        {shown.length === 0 ? "No documents" : `${(currentPage - 1) * pageSize + 1}–${Math.min(currentPage * pageSize, shown.length)} of ${shown.length}`}
      </p>
    </div>

    {selected.size > 0 ? <div role="status" className="mt-3 flex flex-wrap items-center gap-3 rounded-md border border-kh-border bg-kh-bg-subtle px-3 py-2 text-body-sm">
      <span className="font-medium text-kh-text">{selected.size} selected</span>
      <Button size="sm" variant="secondary" onClick={() => setConfirmOpen(true)}>Archive</Button>
      <button type="button" className="kh-focus-ring ml-auto inline-flex min-h-6 items-center rounded-md text-kh-link underline underline-offset-2" onClick={() => setSelected(new Set())}>Clear</button>
    </div> : null}
    {shown.length === 0 ? <div className="mt-3 rounded-md border border-kh-border px-3 py-10 text-center">
      <p className="text-body text-kh-text-muted">{rows.length === 0 ? "No documents yet." : "No documents match."}</p>
      {rows.length > 0 && (query.trim() || sourceId) ? <button type="button" className="kh-focus-ring mt-3 inline-flex min-h-6 items-center rounded-md text-body-sm text-kh-link underline underline-offset-2" onClick={() => { setQuery(""); setSourceId(""); }}>Clear search and source filter</button> : null}
    </div> : <div ref={tableRef} className="mt-3">
      <table className="w-full table-fixed border-collapse text-body">
        <caption className="sr-only">All active documents, with their source, last update and link counts</caption>
        <thead>
          <tr className="bg-kh-bg text-left text-caption text-kh-text-muted sm:sticky sm:top-12 sm:z-10">
            <th scope="col" className="w-10 border-b border-kh-border bg-kh-bg px-2 py-2"><label className="flex h-8 w-8 items-center justify-center"><input type="checkbox" aria-label="Select all documents on this page" checked={allVisibleSelected} onChange={toggleAll} /></label></th>
            {heading("title", "Document")}
            <th scope="col" className="hidden w-48 border-b border-kh-border bg-kh-bg px-3 py-2 font-medium sm:table-cell">Source</th>
            {heading("updated", "Updated", "", "hidden w-40 sm:table-cell")}
            {heading("inDegree", "Links in", "text-right", "hidden w-24 sm:table-cell")}
            {heading("outDegree", "Links out", "text-right", "hidden w-24 sm:table-cell")}
          </tr>
        </thead>
        <tbody onKeyDown={navigateListRows}>
          {visible.map((row) => <tr key={row.documentId} className="kh-index-row border-b border-kh-border last:border-b-0 hover:bg-kh-bg-hover">
            <td className="px-2 py-2.5"><label className="flex h-8 w-8 items-center justify-center"><input type="checkbox" aria-label={`Select ${row.title}`} checked={selected.has(row.documentId)} onChange={() => toggleOne(row.documentId)} /></label></td>
            <th scope="row" className="max-w-0 px-3 py-2.5 text-left font-normal">
              <Link data-list-row href={row.href} className="kh-focus-ring flex min-h-6 min-w-0 items-center gap-2 rounded-md text-kh-text hover:text-kh-link">
                <span aria-hidden="true" className="w-4 shrink-0 text-center text-body leading-none">{row.pageIcon ?? ""}</span>
                <span className="min-w-0">
                  <span className="block truncate font-medium">{row.title}</span>
                  <span className="mt-0.5 block truncate text-caption text-kh-text-muted sm:hidden">{row.sourceName} · <Timestamp value={row.updatedAt} variant="short" />{row.inDegree || row.outDegree ? ` · ${row.inDegree} in · ${row.outDegree} out` : ""}</span>
                </span>
              </Link>
            </th>
            <td className="hidden px-3 py-2.5 text-kh-text-muted sm:table-cell">{row.sourceName}</td>
            <td className="hidden whitespace-nowrap px-3 py-2.5 text-caption text-kh-text-muted sm:table-cell"><Timestamp value={row.updatedAt} variant="short" /></td>
            <td className="hidden px-3 py-2.5 text-right text-caption tabular-nums text-kh-text-muted sm:table-cell">{row.inDegree}</td>
            <td className="hidden px-3 py-2.5 text-right text-caption tabular-nums text-kh-text-muted sm:table-cell">{row.outDegree}</td>
          </tr>)}
        </tbody>
      </table>
      <ConfirmDialog open={confirmOpen} onOpenChange={setConfirmOpen} title={`Archive ${selected.size} ${selected.size === 1 ? "document" : "documents"}?`} description="They leave the active index and can be restored from Insights → Archived documents." confirmLabel="Archive" onConfirm={() => void archiveSelected()} />
      {pageCount > 1 ? <nav aria-label="Knowledge pages" className="mt-4 flex flex-wrap items-center justify-between gap-3 text-caption text-kh-text-muted">
        <span>Showing {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, shown.length)} of {shown.length}</span>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1">Per page
            <SelectMenu aria-label="Rows per page" className="w-20" value={String(pageSize)} onValueChange={(value) => setPageSize(Number(value))} options={PAGE_SIZES.map((size) => ({ value: String(size), label: String(size) }))} />
          </span>
          <button type="button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)} className="kh-focus-ring inline-flex min-h-6 items-center rounded-md px-2 text-kh-link disabled:text-kh-text-muted disabled:no-underline">Previous</button>
          <span className="inline-flex items-center gap-1">Page
            <SelectMenu aria-label="Page" className="w-16" value={String(currentPage)} onValueChange={(value) => setPage(Number(value))} options={Array.from({ length: pageCount }, (_, index) => ({ value: String(index + 1), label: String(index + 1) }))} />
            of {pageCount}</span>
          <button type="button" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)} className="kh-focus-ring inline-flex min-h-6 items-center rounded-md px-2 text-kh-link disabled:text-kh-text-muted disabled:no-underline">Next</button>
        </div>
      </nav> : null}
    </div>}
  </div>;
}

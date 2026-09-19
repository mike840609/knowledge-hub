"use client";

import { Dialog } from "@base-ui-components/react/dialog";
import { Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useWorkspaceAuthorization } from "@/components/shell/use-workspace-authorization";
import { plainSearchSnippet } from "@/lib/search-snippet";

type QuickHit = {
  documentId: string;
  sourceId: string;
  title: string;
  sourceName: string;
  snippet: string;
};

type QuickResponse = { hits: QuickHit[]; tooLong: boolean; timedOut: boolean };

export function QuickSearch({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const { access, confirmed } = useWorkspaceAuthorization();
  const enabled = confirmed && access.actions.canSearch;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<QuickHit[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const trimmed = query.trim();
  const allHref = `/w/${workspaceId}/search${trimmed ? `?q=${encodeURIComponent(trimmed)}` : ""}`;

  useEffect(() => {
    if (!enabled) {
      setOpen(false);
      return;
    }
    const onShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !open || !trimmed) {
      setHits([]);
      setLoading(false);
      setMessage("");
      return;
    }
    const controller = new AbortController();
    setHits([]);
    setLoading(true);
    setMessage("");
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/workspaces/${workspaceId}/quick-search?q=${encodeURIComponent(trimmed)}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Search unavailable");
        const result = await response.json() as QuickResponse;
        setHits(result.hits);
        setActiveIndex(0);
        setMessage(result.tooLong ? "Use at most 200 characters." : result.timedOut ? "Search timed out. Try a shorter query." : "");
      } catch {
        if (!controller.signal.aborted) {
          setHits([]);
          setMessage("Search is unavailable. Try the full search page.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [enabled, open, trimmed, workspaceId]);

  const openDocument = (hit: QuickHit) => {
    setOpen(false);
    router.push(`/w/${workspaceId}/knowledge/${hit.sourceId}/${hit.documentId}`);
  };
  const openAll = () => {
    setOpen(false);
    router.push(allHref);
  };

  if (!enabled) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Quick search"
        title="Quick search (⌘/Ctrl K)"
        className="inline-flex h-8 min-w-8 items-center justify-center gap-2 rounded-md px-2 text-kh-text-muted hover:bg-kh-bg-hover hover:text-kh-text focus:outline-none focus-visible:ring-2 focus-visible:ring-kh-focus sm:px-3"
      >
        <Search className="h-4 w-4" aria-hidden="true" />
        <span className="hidden text-[13px] sm:inline">Search</span>
        <kbd className="ml-3 hidden rounded bg-kh-bg-subtle px-1 text-[10px] lg:inline">⌘K</kbd>
      </button>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/25" />
          <Dialog.Popup className="fixed left-1/2 top-[min(14vh,120px)] z-[60] flex max-h-[75vh] w-[min(640px,calc(100vw-24px))] -translate-x-1/2 flex-col overflow-hidden rounded-xl border border-kh-border bg-kh-bg shadow-xl focus:outline-none">
            <Dialog.Title className="sr-only">Quick search</Dialog.Title>
            <div className="flex items-center gap-3 border-b border-kh-border px-4">
              <Search className="h-4 w-4 shrink-0 text-kh-text-muted" aria-hidden="true" />
              <input
                autoFocus
                type="search"
                value={query}
                maxLength={200}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown" && hits.length) {
                    event.preventDefault();
                    setActiveIndex((index) => Math.min(index + 1, hits.length - 1));
                  } else if (event.key === "ArrowUp" && hits.length) {
                    event.preventDefault();
                    setActiveIndex((index) => Math.max(index - 1, 0));
                  } else if (event.key === "Enter") {
                    event.preventDefault();
                    if (hits[activeIndex]) openDocument(hits[activeIndex]);
                    else openAll();
                  }
                }}
                role="combobox"
                aria-label="Search documents"
                aria-autocomplete="list"
                aria-expanded={hits.length > 0}
                aria-controls="quick-search-results"
                aria-activedescendant={hits[activeIndex] ? `quick-hit-${activeIndex}` : undefined}
                placeholder="Search documents…"
                className="h-14 min-w-0 flex-1 bg-transparent text-sm text-kh-text outline-none placeholder:text-kh-text-muted"
              />
              <Dialog.Close aria-label="Close search" className="rounded p-1 text-kh-text-muted hover:bg-kh-bg-hover focus-visible:ring-2 focus-visible:ring-kh-focus">
                <X className="h-4 w-4" aria-hidden="true" />
              </Dialog.Close>
            </div>
            <div className="min-h-0 overflow-y-auto p-2">
              {loading ? <p role="status" className="px-3 py-3 text-sm text-kh-text-muted">Searching…</p> : null}
              {!loading && message ? <p role="status" className="px-3 py-3 text-sm text-kh-text-muted">{message}</p> : null}
              {!loading && !message && trimmed && hits.length === 0 ? <p role="status" className="px-3 py-3 text-sm text-kh-text-muted">No matching documents.</p> : null}
              {!trimmed ? <p className="px-3 py-3 text-sm text-kh-text-muted">Type to search documents in this workspace.</p> : null}
              <ul id="quick-search-results" role="listbox" aria-label="Documents" className="space-y-0.5">
                {!loading && hits.map((hit, index) => (
                  <li key={hit.documentId} id={`quick-hit-${index}`} role="option" aria-selected={index === activeIndex}>
                    <button type="button" onClick={() => openDocument(hit)} onMouseEnter={() => setActiveIndex(index)} className={`w-full rounded-md px-3 py-2 text-left focus-visible:ring-2 focus-visible:ring-kh-focus ${index === activeIndex ? "bg-kh-bg-selected" : "hover:bg-kh-bg-hover"}`}>
                      <span className={`block truncate text-sm font-medium ${index === activeIndex ? "text-kh-selected-text" : "text-kh-text"}`}>{hit.title}</span>
                      <span className="block truncate text-xs text-kh-text-muted">{hit.sourceName} · {plainSearchSnippet(hit.snippet)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            <button type="button" onClick={openAll} className="flex shrink-0 items-center justify-between border-t border-kh-border px-5 py-3 text-left text-[13px] text-kh-text-muted hover:bg-kh-bg-hover hover:text-kh-text focus-visible:ring-2 focus-visible:ring-kh-focus">
              <span>Open full search</span><span aria-hidden="true">↵</span>
            </button>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

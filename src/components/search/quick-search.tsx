"use client";

import { Dialog } from "@base-ui-components/react/dialog";
import { Search, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useContext, useEffect, useMemo, useState } from "react";
import { useWorkspaceAuthorization } from "@/components/shell/use-workspace-authorization";
import { DocumentTopbarContext } from "@/components/shell/document-topbar-context";
import { ResultListSkeleton } from "@/components/knowledge/knowledge-skeletons";
import { documentShortcutKey, useDocumentShortcuts } from "@/components/knowledge/use-document-shortcuts";
import { useActionRunner } from "@/components/actions/action-menu";
import { ActionIcon } from "@/components/actions/action-icon";
import {
  actionGroupLabels,
  actionsFor,
  matchActions,
  type Action,
} from "@/components/actions/action-registry";
import { plainSearchSnippet } from "@/lib/search-snippet";
import { toggleFavoriteDocument } from "@/lib/document-shortcuts";
import { buttonClasses } from "@/components/ui/button";

type QuickHit = {
  documentId: string;
  sourceId: string;
  title: string;
  sourceName: string;
  snippet: string;
};

type QuickResponse = { hits: QuickHit[]; tooLong: boolean; timedOut: boolean };

/**
 * One list, two kinds of row. Arrow keys and Enter move over the merged list
 * rather than over the documents alone, because from the reader's side there
 * is no seam: they typed something and the thing they want is on screen.
 */
type PaletteRow = { kind: "action"; action: Action } | { kind: "hit"; hit: QuickHit };

/**
 * `⌘K`.
 *
 * It was already a palette in everything but content — a dialog, a filtered
 * list, arrow keys, `aria-activedescendant` — and searched documents only.
 * What it gained is the registry's actions, which is the honest scope of this
 * product's palette: mostly a way to get somewhere, plus the few things a
 * reader can actually do. It does not invent commands that do not exist.
 */
export function QuickSearch({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const { access, confirmed } = useWorkspaceAuthorization();
  const topbar = useContext(DocumentTopbarContext)?.document;
  const { shortcuts, update: updateShortcuts } = useDocumentShortcuts(workspaceId);
  const enabled = confirmed && access.actions.canSearch;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<QuickHit[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const trimmed = query.trim();
  const allHref = `/w/${workspaceId}/search${trimmed ? `?q=${encodeURIComponent(trimmed)}` : ""}`;

  const runAction = useActionRunner({
    onToggleFavorite: (sourceId, documentId) =>
      updateShortcuts((previous) =>
        toggleFavoriteDocument(previous, documentShortcutKey(sourceId, documentId)),
      ),
  });

  // Document actions apply to the document being read, and only while the
  // topbar state belongs to the route actually on screen.
  const reading = topbar?.pathname === pathname ? topbar.target : undefined;
  const actions = useMemo(
    () =>
      actionsFor("palette", {
        workspaceId,
        workspaceType: access.workspace.type,
        can: access.actions,
        confirmed,
        target: reading
          ? {
              ...reading,
              favorite: shortcuts.favorites.includes(
                documentShortcutKey(reading.sourceId, reading.documentId),
              ),
            }
          : undefined,
      }),
    [workspaceId, access.workspace.type, access.actions, confirmed, reading, shortcuts.favorites],
  );

  const matched = useMemo(() => matchActions(actions, trimmed), [actions, trimmed]);
  const rows = useMemo<PaletteRow[]>(
    () => [
      ...matched.map((action) => ({ kind: "action" as const, action })),
      ...hits.map((hit) => ({ kind: "hit" as const, hit })),
    ],
    [matched, hits],
  );
  // The first row is the default target, and the row set changes as results
  // arrive; leaving the index where it was would point it at something else.
  useEffect(() => setActiveIndex(0), [trimmed, open]);
  const activeRow = rows[activeIndex];

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
  // Closing first: an action that opens the inspector or navigates should not
  // have to do it behind a dialog that is still on top of the page.
  const choose = (row: PaletteRow) => {
    if (row.kind === "hit") {
      openDocument(row.hit);
      return;
    }
    setOpen(false);
    runAction(row.action);
  };

  if (!enabled) return null;

  let rowIndex = -1;
  const groupsShown = new Set<string>();

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Quick search"
        title="Quick search (⌘/Ctrl K)"
        className={buttonClasses({ variant: "ghost" })}
      >
        <Search className="h-4 w-4" aria-hidden="true" />
        <span className="hidden text-body-sm sm:inline">Search</span>
        <kbd className="ml-3 hidden rounded-md bg-kh-bg-subtle px-1 text-micro text-kh-text-faint lg:inline">⌘K</kbd>
      </button>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-50 bg-kh-overlay transition-opacity duration-120 ease-out data-[starting-style]:opacity-0 data-[ending-style]:opacity-0" />
          <Dialog.Popup className="fixed left-1/2 top-[min(14vh,120px)] z-[60] flex max-h-[75vh] w-[min(640px,calc(100vw-24px))] -translate-x-1/2 flex-col overflow-hidden rounded-xl border border-kh-border bg-kh-bg shadow-modal outline-none transition-[opacity,transform] duration-120 ease-out data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0 data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0">
            <Dialog.Title className="sr-only">Search and actions</Dialog.Title>
            <div className="flex items-center gap-3 border-b border-kh-border px-4">
              <Search className="h-4 w-4 shrink-0 text-kh-text-muted" aria-hidden="true" />
              <input
                autoFocus
                type="search"
                value={query}
                maxLength={200}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown" && rows.length) {
                    event.preventDefault();
                    setActiveIndex((index) => Math.min(index + 1, rows.length - 1));
                  } else if (event.key === "ArrowUp" && rows.length) {
                    event.preventDefault();
                    setActiveIndex((index) => Math.max(index - 1, 0));
                  } else if (event.key === "Enter") {
                    event.preventDefault();
                    if (activeRow) choose(activeRow);
                    else openAll();
                  }
                }}
                role="combobox"
                aria-label="Search documents and actions"
                aria-autocomplete="list"
                aria-expanded={rows.length > 0}
                aria-controls="quick-search-results"
                aria-activedescendant={activeRow ? `quick-row-${activeIndex}` : undefined}
                placeholder="Search documents, or run an action…"
                className="h-14 min-w-0 flex-1 bg-transparent text-body text-kh-text outline-none placeholder:text-kh-text-muted"
              />
              <Dialog.Close aria-label="Close search" className={buttonClasses({ variant: "ghost", icon: true, size: "sm" })}>
                <X className="h-4 w-4" aria-hidden="true" />
              </Dialog.Close>
            </div>
            <div className="min-h-0 overflow-y-auto p-2">
              <ul id="quick-search-results" role="listbox" aria-label="Actions and documents" className="space-y-0.5">
                {matched.map((action) => {
                  rowIndex += 1;
                  const index = rowIndex;
                  const first = !groupsShown.has(action.group);
                  groupsShown.add(action.group);
                  return (
                    <li key={action.id} id={`quick-row-${index}`} role="option" aria-selected={index === activeIndex}>
                      {first ? (
                        <p aria-hidden="true" className="px-3 pb-1 pt-2 text-caption font-semibold text-kh-text-muted">
                          {actionGroupLabels[action.group]}
                        </p>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => choose({ kind: "action", action })}
                        onMouseEnter={() => setActiveIndex(index)}
                        className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left kh-focus-ring ${index === activeIndex ? "bg-kh-bg-selected" : "hover:bg-kh-bg-hover"}`}
                      >
                        <ActionIcon name={action.icon} />
                        <span className={`min-w-0 flex-1 truncate text-body ${index === activeIndex ? "text-kh-selected-text" : "text-kh-text"}`}>
                          {action.label}
                        </span>
                      </button>
                    </li>
                  );
                })}
                {!loading && hits.map((hit) => {
                  rowIndex += 1;
                  const index = rowIndex;
                  return (
                    <li key={hit.documentId} id={`quick-row-${index}`} role="option" aria-selected={index === activeIndex}>
                      <button type="button" onClick={() => choose({ kind: "hit", hit })} onMouseEnter={() => setActiveIndex(index)} className={`w-full rounded-md px-3 py-2 text-left kh-focus-ring ${index === activeIndex ? "bg-kh-bg-selected" : "hover:bg-kh-bg-hover"}`}>
                        <span className={`block truncate text-body font-medium ${index === activeIndex ? "text-kh-selected-text" : "text-kh-text"}`}>{hit.title}</span>
                        <span className="block truncate text-caption text-kh-text-muted">{hit.sourceName} · {plainSearchSnippet(hit.snippet)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {loading ? <ResultListSkeleton /> : null}
              {!loading && message ? <p role="status" className="px-3 py-3 text-body text-kh-text-muted">{message}</p> : null}
              {!loading && !message && trimmed && rows.length === 0 ? <p role="status" className="px-3 py-3 text-body text-kh-text-muted">Nothing matches that.</p> : null}
              {/* Said even when actions matched: otherwise a query that hits an
                  action but no document looks like a search that never ran. */}
              {!loading && !message && trimmed && hits.length === 0 && matched.length > 0 ? <p role="status" className="px-3 py-2 text-body-sm text-kh-text-muted">No matching documents.</p> : null}
            </div>
            {/* Only with a query: without one this is the "Open full search"
                row again. ↵ is shown only when Enter would really do this,
                which is when there is no row for it to choose instead. */}
            {trimmed ? (
              <button type="button" onClick={openAll} className="flex shrink-0 items-center justify-between gap-3 border-t border-kh-border px-5 py-3 text-left text-body-sm text-kh-text-muted hover:bg-kh-bg-hover hover:text-kh-text kh-focus-ring">
                <span className="min-w-0 truncate">Search all documents for “{trimmed}”</span>
                {activeRow ? null : <span aria-hidden="true">↵</span>}
              </button>
            ) : null}
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

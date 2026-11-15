"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Popover } from "@base-ui-components/react/popover";
import { FileText, ImagePlus } from "lucide-react";
import { EMOJI_GROUPS, searchEmoji, type Emoji } from "@/lib/emoji-catalog";
import { governanceRequest } from "@/components/workspaces/governance-error";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

/**
 * The page's icon, above its title. A bundled, searchable catalog of about 350
 * emoji (English and Traditional Chinese keywords), "Suggested" first: a closed
 * set rather than a free emoji keyboard, because the icon is a scanning aid in
 * a dense tree. The search field takes focus on open; arrows move through the
 * grid, Enter chooses, Escape closes and returns focus to the trigger.
 *
 * The icon belongs to the document, not the revision. Changing it is one small
 * authenticated write and never makes a new revision.
 */
export function PageIconPicker({
  documentId,
  icon,
  editable,
}: {
  documentId: string;
  icon: string | null;
  editable: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [current, setCurrent] = useState(icon);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => setCurrent(icon), [icon]);
  useEffect(() => { if (!open) { setQuery(""); setActive(null); } }, [open]);

  // No query: every group, Suggested first, nothing twice. A query: one list in catalog order.
  const sections = useMemo(() => {
    const needle = query.trim();
    return needle ? [{ id: "results", label: "Results", emoji: searchEmoji(needle) }] : EMOJI_GROUPS;
  }, [query]);
  // Roving tabindex: one cell is the grid's tab stop (the last focused, else the first), so Tab
  // goes from the field through the grid to "Remove icon" in two presses, not 351.
  const [active, setActive] = useState<string | null>(null);
  const firstChar = sections.find((section) => section.emoji.length > 0)?.emoji[0]?.char ?? null;
  const tabChar = active !== null && sections.some((section) => section.emoji.some((entry) => entry.char === active)) ? active : firstChar;
  const none = sections.every((section) => section.emoji.length === 0);

  const cells = () => Array.from(gridRef.current?.querySelectorAll<HTMLButtonElement>("button[data-emoji]") ?? []);

  /** The cell one row above or below, nearest in column: rows are read from where the browser drew them. */
  function vertical(from: HTMLButtonElement, direction: 1 | -1) {
    const box = from.getBoundingClientRect();
    let best: HTMLButtonElement | null = null;
    let bestRow = Infinity;
    let bestGap = Infinity;
    for (const cell of cells()) {
      const other = cell.getBoundingClientRect();
      const rowDelta = (other.top - box.top) * direction;
      if (rowDelta <= 1) continue;
      const gap = Math.abs(other.left - box.left);
      if (rowDelta < bestRow - 1 || (Math.abs(rowDelta - bestRow) <= 1 && gap < bestGap)) { best = cell; bestRow = rowDelta; bestGap = gap; }
    }
    return best;
  }

  function onGridKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    const from = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-emoji]");
    if (!from) return;
    const all = cells();
    const index = all.indexOf(from);
    let next: HTMLElement | null | undefined;
    if (event.key === "ArrowRight") next = all[index + 1];
    else if (event.key === "ArrowLeft") next = index === 0 ? searchRef.current : all[index - 1];
    else if (event.key === "ArrowDown") next = vertical(from, 1);
    else if (event.key === "ArrowUp") next = vertical(from, -1) ?? searchRef.current;
    else if (event.key === "Home") next = all[0];
    else if (event.key === "End") next = all[all.length - 1];
    else return;
    event.preventDefault();
    next?.focus();
  }

  function onSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      cells()[0]?.focus();
    } else if (event.key === "Enter") {
      event.preventDefault();
      const first = cells()[0];
      if (first?.dataset.emoji) void save(first.dataset.emoji);
    }
  }

  async function save(next: string | null) {
    if (saving) return;
    const previous = current;
    setSaving(true);
    setCurrent(next);
    try {
      await governanceRequest(`/api/documents/${documentId}/icon`, "PUT", { icon: next });
      setOpen(false);
      router.refresh();
    } catch {
      setCurrent(previous);
      toast({ message: "The page icon could not be saved.", tone: "danger" });
    } finally {
      setSaving(false);
    }
  }

  if (!editable) {
    return current ? <span data-page-icon className="mt-2 block select-none text-display leading-8" aria-hidden="true">{current}</span> : null;
  }

  return (
    <div className="mt-2">
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger
          type="button"
          aria-label={current ? "Change page icon" : "Add page icon"}
          className="kh-focus-ring group inline-flex h-10 min-w-10 items-center gap-1.5 rounded-md px-1 text-kh-text-muted transition-colors hover:bg-kh-bg-hover hover:text-kh-text aria-expanded:bg-kh-bg-hover aria-expanded:text-kh-text"
        >
          {current ? (
            <span data-page-icon className="select-none text-display leading-8" aria-hidden="true">{current}</span>
          ) : (
            // The document's mark at rest; the labelled add affordance on hover
            // (where hover exists) or focus, as Notion reveals it.
            <>
              <FileText className="h-5 w-5 shrink-0 group-focus-visible:hidden [@media(hover:hover)_and_(pointer:fine)]:group-hover:hidden" aria-hidden="true" />
              <span className="hidden items-center gap-1.5 group-focus-visible:inline-flex [@media(hover:hover)_and_(pointer:fine)]:group-hover:inline-flex" aria-hidden="true">
                <ImagePlus className="h-5 w-5" />
                <span className="text-body-sm">Add icon</span>
              </span>
            </>
          )}
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner side="bottom" align="start" sideOffset={6} className="z-50">
            <Popover.Popup initialFocus={searchRef} className="w-72 rounded-lg border border-kh-border bg-kh-bg p-2 shadow-popover outline-none transition-[opacity,transform] duration-120 ease-out data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0 data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0">
              <Popover.Title className="px-1 pb-2 text-caption font-semibold text-kh-text-muted">Page icon</Popover.Title>
              <Input
                ref={searchRef}
                size="sm"
                type="search"
                aria-label="Search emoji"
                placeholder="Search emoji"
                autoComplete="off"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={onSearchKeyDown}
                className="mb-2"
              />
              <div ref={gridRef} onKeyDown={onGridKeyDown} className="max-h-64 overflow-y-auto">
                {none ? (
                  <p role="status" className="px-1 py-6 text-center text-body-sm text-kh-text-muted">No emoji match.</p>
                ) : (
                  sections.map((section) =>
                    section.emoji.length === 0 ? null : (
                      <div key={section.id} role="group" aria-label={section.label} className="mb-2">
                        <p className="px-1 pb-1 text-caption font-semibold text-kh-text-muted">{section.label}</p>
                        <div className="grid grid-cols-8 gap-0.5">
                          {section.emoji.map((choice: Emoji) => (
                            <button
                              key={choice.char}
                              type="button"
                              data-emoji={choice.char}
                              tabIndex={choice.char === tabChar ? 0 : -1}
                              onFocus={() => setActive(choice.char)}
                              aria-label={`Use ${choice.char}`}
                              title={choice.name}
                              aria-pressed={current === choice.char}
                              disabled={saving}
                              onClick={() => void save(choice.char)}
                              className="flex h-8 w-8 items-center justify-center rounded-md text-heading outline-none hover:bg-kh-bg-hover focus-visible:bg-kh-bg-hover aria-pressed:bg-kh-bg-selected"
                            >
                              {choice.char}
                            </button>
                          ))}
                        </div>
                      </div>
                    ),
                  )
                )}
              </div>
              {current ? (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void save(null)}
                  className="kh-focus-ring mt-2 w-full rounded-md px-2 py-1.5 text-left text-body-sm text-kh-text-muted hover:bg-kh-bg-hover hover:text-kh-text"
                >
                  Remove icon
                </button>
              ) : null}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}

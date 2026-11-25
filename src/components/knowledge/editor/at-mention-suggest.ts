import { editorViewOptionsCtx } from "@milkdown/kit/core";
import type { Ctx, MilkdownPlugin } from "@milkdown/kit/ctx";
import { closeHistory } from "@milkdown/kit/prose/history";
import { Plugin, PluginKey, type EditorState } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import { isIsoDate, isoDate } from "./date-text";
import { typedAt } from "./emoji-suggest";
import { rankSuggestions, findWikiLinkTrigger, type Suggestion } from "./link-suggestions";
import { insertWikiLink, type LinkTargetsStore } from "./wikilink-suggest";
import { keepsAsText } from "./wiki-link";

/** How many pages the list shows; the `[[` list shows eight, an `@` list is a shortcut, not a search. */
export const MENTION_PAGE_LIMIT = 5;
export const MENTION_QUERY_LIMIT = 40;

export type MentionRow =
  | { kind: "page"; id: string; label: string; detail: string; suggestion: Suggestion }
  | { kind: "date"; id: string; label: string; detail: string; text: string };

export type MentionGroup = { name: "Pages" | "Dates"; rows: MentionRow[]; note: string | null };

type Trigger = { from: number; to: number; query: string };
type State = { trigger: Trigger | null; dismissed: number | null; index: number };

/**
 * `@` at the start of a block, or after whitespace, an opening bracket or quote, an inline node or a Han character,
 * then a query: no `@`, `:` (the emoji list's) or `/` (the `/` list's), and it does not begin with a space
 * (`email me @ 5pm` is prose). `a@b` is an address: a word character before it is no boundary.
 */
const TRIGGER = new RegExp(`(?:^|[\\s\\ufffc([{"'“‘]|\\p{Script=Han})@([^\\s@:/\\ufffc][^@:/\\n\\ufffc]{0,${MENTION_QUERY_LIMIT - 1}})?$`, "u");

type DateKind = { name: string; offset: number; words: string[] };
const DATES: readonly DateKind[] = [
  { name: "Today", offset: 0, words: ["today", "今天"] },
  { name: "Tomorrow", offset: 1, words: ["tomorrow", "明天"] },
  { name: "Yesterday", offset: -1, words: ["yesterday", "昨天"] },
];

/** The date rows a query asks for: a name it begins, or a complete real `YYYY-MM-DD`. Pure, for the tests. */
export function dateRows(query: string, now: Date = new Date()): MentionRow[] {
  const wanted = query.trim().toLowerCase();
  const rows: MentionRow[] = [];
  for (const date of DATES) {
    if (wanted !== "" && !date.words.some((word) => word.startsWith(wanted))) continue;
    const text = isoDate(date.offset, now);
    rows.push({ kind: "date", id: `date-${date.name}`, label: date.name, detail: text, text });
  }
  if (isIsoDate(wanted)) rows.push({ kind: "date", id: "date-typed", label: wanted, detail: "Date", text: wanted });
  return rows;
}

export type AtMentionOptions = {
  /** `wikiLinkSuggest(...).targets`: the Workspace's documents, fetched once for both lists. */
  targets: LinkTargetsStore;
  /** The document being written, when it exists: a link to itself is never what `@` is for. */
  excludeDocumentId?: () => string | undefined;
  now?: () => Date;
};

let sequence = 0;

/**
 * The `@` list of the rendered editor (2026-11-25 spec): pages of this Workspace, written as the `[[` list writes them
 * (`insertWikiLink`), and dates, written as the text `/Today's date` writes. It offers; it stores nothing the editor
 * does not already write, and it grants no read of any page it names. Keys go through the editor's direct
 * `handleKeyDown`, as the `[[` and emoji lists' do.
 */
export function atMentionSuggest(options: AtMentionOptions): { plugins: MilkdownPlugin[]; configure: (ctx: Ctx) => void } {
  const key = new PluginKey<State>("khAtMentionSuggest");
  const clock = options.now ?? (() => new Date());
  let visible = false;
  let shown: readonly MentionGroup[] = [];
  const flat = () => shown.flatMap((group) => group.rows);

  /** What the list holds for a query: dates first when one begins with what was typed, pages first otherwise. */
  function groupsFor(query: string): MentionGroup[] {
    options.targets.ensure();
    const { targets, failed } = options.targets.snapshot();
    const skip = options.excludeDocumentId?.();
    const pages: MentionGroup = { name: "Pages", rows: [], note: null };
    if (targets === null) pages.note = failed ? "Couldn't load pages." : "Loading pages…";
    else {
      const found = rankSuggestions(skip ? targets.filter((target) => target.documentId !== skip) : targets, query.trim(), MENTION_PAGE_LIMIT);
      pages.rows = found.map((suggestion, index) => ({
        kind: "page", id: `page-${index}-${suggestion.target.documentId}`, label: suggestion.target.title, detail: suggestion.target.sourceName, suggestion,
      }));
    }
    const dates: MentionGroup = { name: "Dates", rows: dateRows(query, clock()), note: null };
    const ordered = query.trim() !== "" && dates.rows.length > 0 ? [dates, pages] : [pages, dates];
    // A group with nothing to show and nothing to say has no heading; a pages group that is only loading still says so.
    return ordered.filter((group) => group.rows.length > 0 || group.note !== null);
  }

  function choose(view: EditorView, row: MentionRow) {
    const state = key.getState(view.state);
    if (!state?.trigger || !view.editable) return;
    const { from, to } = state.trigger;
    if (row.kind === "page") insertWikiLink(view, from, to, row.suggestion.link);
    else {
      // The caret sat at `to`; replacing the trigger leaves it after the date. Plain text, its own undo step.
      view.dispatch(closeHistory(view.state.tr.insertText(row.text, from, to)).scrollIntoView());
      view.dispatch(closeHistory(view.state.tr));
      view.focus();
    }
  }

  const plugin = $prose(() => new Plugin<State>({
    key,
    state: {
      init: () => ({ trigger: null, dismissed: null, index: 0 }),
      apply(transaction, previous, before, after) {
        const detected = detect(after);
        const meta = transaction.getMeta(key) as { dismiss?: true; index?: number } | undefined;
        // The list answers typing, never a caret placed on text already there.
        const continuing = previous.trigger !== null && detected !== null && transaction.mapping.map(previous.trigger.from) === detected.from;
        const trigger = detected && (continuing || typedAt(transaction, before, detected)) ? detected : null;
        if (trigger === null) return { trigger: null, dismissed: null, index: 0 };
        const changed = !previous.trigger || previous.trigger.query !== trigger.query;
        return {
          trigger,
          dismissed: meta?.dismiss ? trigger.from : previous.dismissed === null ? null : transaction.mapping.map(previous.dismissed),
          index: meta?.index ?? (changed ? 0 : previous.index),
        };
      },
    },
    view(view) {
      const id = `kh-at-${++sequence}`;
      const popup = document.createElement("div");
      popup.className = "kh-at-menu";
      popup.hidden = true;
      const announce = document.createElement("div");
      announce.className = "sr-only";
      announce.setAttribute("aria-live", "polite");
      announce.setAttribute("aria-atomic", "true");
      const list = document.createElement("div");
      list.id = id;
      list.setAttribute("role", "listbox");
      list.setAttribute("aria-label", "Mentions");
      popup.append(announce, list);
      document.body.appendChild(popup);
      const dom = view.dom;
      const restored = new Map<string, string | null>();
      const attrs = ["role", "aria-haspopup", "aria-autocomplete", "aria-expanded", "aria-controls", "aria-activedescendant"];
      let ownsAria = false;
      let announced = "";

      function close() {
        visible = false;
        shown = [];
        popup.hidden = true;
        announced = "";
        announce.textContent = "";
        if (ownsAria && dom.getAttribute("aria-controls") === id) {
          for (const name of attrs) {
            const value = restored.get(name);
            if (value == null) dom.removeAttribute(name); else dom.setAttribute(name, value);
          }
        }
        restored.clear();
        ownsAria = false;
      }

      function position() {
        const trigger = key.getState(view.state)?.trigger;
        if (!visible || !trigger) return;
        try {
          const rect = view.coordsAtPos(trigger.from);
          popup.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - popup.offsetWidth - 8))}px`;
          const height = popup.offsetHeight;
          const below = window.innerHeight - rect.bottom - 8;
          popup.style.top = `${Math.max(8, below >= height ? rect.bottom + 4 : rect.top - height - 4)}px`;
        } catch { /* no layout (jsdom): the rows still work from the keyboard */ }
      }

      function sync() {
        const state = key.getState(view.state);
        const trigger = state?.trigger ?? null;
        const dismissed = trigger !== null && state?.dismissed === trigger.from;
        const groups = trigger && !dismissed ? groupsFor(trigger.query) : [];
        const rows = groups.flatMap((group) => group.rows);
        // Another list (`[[`, `/`, `:`) or the link card may own the editor's combobox; two owners would leave
        // the ARIA pointing at whichever closed last.
        const owner = dom.getAttribute("aria-controls");
        const otherMenu = dom.getAttribute("aria-expanded") === "true" && owner && owner !== id;
        // Nothing to choose: the list lets go (a loading pages group alone is not worth a box under every `@`).
        if (otherMenu || !view.editable || !view.hasFocus() || !trigger || dismissed || rows.length === 0 || view.composing) { close(); return; }
        shown = groups;
        const active = Math.min(state!.index, rows.length - 1);
        list.replaceChildren();
        let at = 0;
        groups.forEach((group, groupIndex) => {
          const section = document.createElement("div");
          section.setAttribute("role", "group");
          const heading = document.createElement("div");
          heading.id = `${id}-heading-${groupIndex}`;
          heading.className = "kh-at-heading";
          heading.textContent = group.name;
          section.setAttribute("aria-labelledby", heading.id);
          section.appendChild(heading);
          for (const entry of group.rows) {
            const index = at++;
            const row = document.createElement("div");
            row.id = `${id}-${index}`;
            row.setAttribute("role", "option");
            row.setAttribute("aria-selected", String(index === active));
            row.className = "kh-at-option";
            const label = document.createElement("span");
            label.className = "min-w-0 flex-1 truncate";
            label.textContent = entry.label;
            const detail = document.createElement("span");
            detail.className = "max-w-[40%] shrink-0 truncate text-caption text-kh-text-muted";
            detail.textContent = entry.detail;
            row.append(label, detail);
            // `mousedown`, not `click`: it arrives before the editor could lose its selection.
            row.addEventListener("mousedown", (event) => { if (event.button === 0) { event.preventDefault(); choose(view, entry); } });
            section.appendChild(row);
          }
          if (group.note) {
            const note = document.createElement("p");
            note.className = "kh-at-note";
            note.textContent = group.note;
            section.appendChild(note);
          }
          list.appendChild(section);
        });
        popup.hidden = false;
        visible = true;
        const said = `${rows.length} ${rows.length === 1 ? "suggestion" : "suggestions"}.`;
        if (said !== announced) { announced = said; announce.textContent = said; }
        if (!ownsAria) { for (const name of attrs) restored.set(name, dom.getAttribute(name)); ownsAria = true; }
        dom.setAttribute("role", "combobox");
        dom.setAttribute("aria-haspopup", "listbox");
        dom.setAttribute("aria-autocomplete", "list");
        dom.setAttribute("aria-expanded", "true");
        dom.setAttribute("aria-controls", id);
        dom.setAttribute("aria-activedescendant", `${id}-${active}`);
        position();
        list.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: "nearest" });
      }

      // The popup's padding and scrollbar are part of it: a press there must not blur the editor.
      popup.addEventListener("mousedown", (event) => { if (event.button === 0) event.preventDefault(); });
      const onFocus = () => sync();
      const onBlur = () => close();
      const onCompositionStart = () => close();
      const onCompositionEnd = () => sync();
      dom.addEventListener("focus", onFocus);
      dom.addEventListener("blur", onBlur);
      dom.addEventListener("compositionstart", onCompositionStart);
      dom.addEventListener("compositionend", onCompositionEnd);
      window.addEventListener("scroll", position, true);
      window.addEventListener("resize", position);
      // The pages arrive after the `@` was typed: draw again.
      const unsubscribe = options.targets.subscribe(sync);
      return {
        update: sync,
        destroy() {
          unsubscribe();
          close();
          popup.remove();
          dom.removeEventListener("focus", onFocus);
          dom.removeEventListener("blur", onBlur);
          dom.removeEventListener("compositionstart", onCompositionStart);
          dom.removeEventListener("compositionend", onCompositionEnd);
          window.removeEventListener("scroll", position, true);
          window.removeEventListener("resize", position);
        },
      };
    },
  }));

  return {
    plugins: [plugin],
    configure(ctx) {
      ctx.update(editorViewOptionsCtx, (previous) => ({
        ...previous,
        handleKeyDown(view, event) {
          if (!visible || !view.editable || event.isComposing || event.keyCode === 229) return Boolean(previous.handleKeyDown?.(view, event));
          if (event.metaKey || event.ctrlKey || event.altKey) return Boolean(previous.handleKeyDown?.(view, event));
          const state = key.getState(view.state);
          const rows = flat();
          if (!state?.trigger || rows.length === 0) return Boolean(previous.handleKeyDown?.(view, event));
          if ((event.key === "ArrowDown" || event.key === "ArrowUp") && !event.shiftKey) {
            event.preventDefault();
            const index = (Math.min(state.index, rows.length - 1) + (event.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length;
            view.dispatch(view.state.tr.setMeta(key, { index }));
            return true;
          }
          if ((event.key === "Enter" || event.key === "Tab") && !event.shiftKey) {
            event.preventDefault();
            choose(view, rows[Math.min(state.index, rows.length - 1)]);
            return true;
          }
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            view.dispatch(view.state.tr.setMeta(key, { dismiss: true }));
            return true;
          }
          return Boolean(previous.handleKeyDown?.(view, event));
        },
      }));
    },
  };
}

function detect(state: EditorState): Trigger | null {
  const { selection } = state;
  if (!selection.empty) return null;
  const { $from } = selection;
  const parent = $from.parent;
  if (!parent.isTextblock || parent.type.spec.code === true) return null;
  if ((state.storedMarks ?? $from.marks()).some(keepsAsText)) return null;
  // Only the end of a huge pasted paragraph can hold a trigger; do not rebuild all of it per key. An inline node
  // is one character no query holds, so offsets and positions stay one to one.
  const offset = Math.max(0, $from.parentOffset - (MENTION_QUERY_LIMIT + 8));
  const before = parent.textBetween(offset, $from.parentOffset, undefined, "￼");
  const found = TRIGGER.exec(before);
  if (!found) return null;
  // A `[[` link being written owns the line, and its query may hold an `@`.
  if (findWikiLinkTrigger(parent.textBetween(0, $from.parentOffset, undefined, "￼"))) return null;
  const query = found[1] ?? "";
  const from = $from.start() + offset + before.length - query.length - 1;
  // `textBetween` drops mark boundaries: inline code or link text before the caret must not count.
  let protectedText = false;
  state.doc.nodesBetween(from, $from.pos, (node) => {
    if (node.marks.some(keepsAsText)) protectedText = true;
  });
  return protectedText ? null : { from, to: $from.pos, query };
}

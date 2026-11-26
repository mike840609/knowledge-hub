import { closeHistory } from "@milkdown/kit/prose/history";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey, TextSelection, type Transaction } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet, type EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";

/**
 * Find and replace in the rendered editor (2026-11-26 spec). The plugin owns what is found (matches, the current
 * one, the highlights); `find-bar.tsx` draws the bar from the controller's snapshot. Neither reaches the document
 * except through ordinary transactions, so a replacement is an edit like any other.
 */
export type FindMatch = { from: number; to: number };
type FindState = { open: boolean; query: string; matchCase: boolean; matches: FindMatch[]; truncated: boolean; current: number };
type FindMeta = { open?: boolean; query?: string; matchCase?: boolean; current?: number; after?: number };

/** Past this many the rest are not kept: the count says "1000+". */
export const FIND_MATCH_LIMIT = 1000;
/** A selection longer than this, or over two lines, is not a word the writer is looking for. */
const PREFILL_LIMIT = 200;
/** Stands for every non-text inline node (a wikilink, a hard break, an image): one position, never matched. */
const BARRIER = "￼";

const key = new PluginKey<FindState>("khFindReplace");
const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const idle: FindState = { open: false, query: "", matchCase: false, matches: [], truncated: false, current: 0 };

/** Matches in each textblock's own text; none spans two blocks, and none crosses or enters a non-text inline node. */
export function findMatches(doc: ProseNode, query: string, matchCase: boolean): { matches: FindMatch[]; truncated: boolean } {
  const needle = query.split(BARRIER).join("");
  const matches: FindMatch[] = [];
  if (!needle) return { matches, truncated: false };
  const pattern = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), matchCase ? "gu" : "giu");
  let truncated = false;
  doc.descendants((node, pos) => {
    if (truncated) return false;
    if (!node.isTextblock) return true;
    const text = node.textBetween(0, node.content.size, undefined, BARRIER);
    pattern.lastIndex = 0;
    for (let found = pattern.exec(text); found; found = pattern.exec(text)) {
      if (matches.length >= FIND_MATCH_LIMIT) { truncated = true; break; }
      // `pos + 1` is the first position inside the block; a leaf node is one position and one character of `text`.
      matches.push({ from: pos + 1 + found.index, to: pos + 1 + found.index + found[0].length });
    }
    return false;
  });
  return { matches, truncated };
}

/** The index of the first match starting at or after `pos`; the first match when none does (wrapping). */
const firstFrom = (matches: FindMatch[], pos: number) => Math.max(0, matches.findIndex(match => match.from >= pos));

export type FindKeyAction = "open" | "openReplace" | "next" | "previous";
/** What a key does for the bar. Mod-G and Mod-Shift-G are the bar's only while it is open; the browser's otherwise. */
export function findKeyAction(event: KeyboardEvent, open: boolean): FindKeyAction | null {
  if (event.isComposing || event.keyCode === 229) return null;
  // Windows reports AltGr as Ctrl+Alt; AltGr+F types "[" on some layouts, which must reach the editor.
  if (event.getModifierState?.("AltGraph")) return null;
  if (!(isMac() ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey)) return null;
  // By physical key for Alt: Option-F types "ƒ" on a Mac.
  if (event.altKey) return !event.shiftKey && event.code === "KeyF" ? "openReplace" : null;
  const letter = event.key.toLowerCase();
  if (letter === "f" && !event.shiftKey) return "open";
  if (letter === "g" && open) return event.shiftKey ? "previous" : "next";
  return null;
}

export type FindSnapshot = {
  open: boolean; query: string; matchCase: boolean; replaceOpen: boolean; editable: boolean;
  total: number; index: number; truncated: boolean;
  /** What the last Replace all did, until the writer searches or steps again. */
  notice: string;
  /** Counts up whenever the query field should take focus (opening, or Mod-F while open). */
  focusToken: number;
};

export type FindController = {
  /** The zero-height sticky anchor the bar is drawn into; the plugin keeps it at the top of the editor's host. */
  mount: HTMLElement;
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => FindSnapshot;
  open: (options?: { replace?: boolean }) => void;
  close: () => void;
  setQuery: (query: string) => void;
  setMatchCase: (matchCase: boolean) => void;
  setReplaceOpen: (open: boolean) => void;
  step: (direction: 1 | -1) => void;
  replace: (text: string) => void;
  replaceAll: (text: string) => void;
};

export function findReplace(): { plugin: ReturnType<typeof $prose>; controller: FindController } {
  const mount = document.createElement("div");
  mount.className = "kh-find-anchor";
  mount.hidden = true;
  let view: EditorView | null = null;
  let replaceOpen = false;
  let notice = "";
  let focusToken = 0;
  const listeners = new Set<() => void>();
  const stateOf = () => (view ? key.getState(view.state) ?? idle : idle);
  const build = (): FindSnapshot => {
    const state = stateOf();
    return { open: state.open, query: state.query, matchCase: state.matchCase, replaceOpen, editable: !!view?.editable, total: state.matches.length, index: state.current, truncated: state.truncated, notice, focusToken };
  };
  let snapshot = build();
  const refresh = () => {
    const next = build();
    mount.hidden = !next.open;
    if ((Object.keys(next) as (keyof FindSnapshot)[]).every(name => next[name] === snapshot[name])) return;
    snapshot = next;
    listeners.forEach(listener => listener());
  };
  const ensureMounted = () => {
    const host = view?.dom.parentElement;
    if (host && mount.parentElement !== host) host.prepend(mount);
  };
  const dispatchMeta = (meta: FindMeta) => { if (view) view.dispatch(view.state.tr.setMeta(key, meta)); };

  const select = (index: number) => {
    if (!view) return;
    const match = stateOf().matches[index];
    if (!match) return;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, match.from, match.to)).setMeta(key, { current: index } satisfies FindMeta));
    reveal();
  };
  /** Centred, not ProseMirror's 5px margin: the pinned header and the bar itself cover the pane's top edge. */
  const reveal = () => { view?.dom.querySelector(".kh-find-current")?.scrollIntoView?.({ block: "center", inline: "nearest" }); };
  /** After a search: the current match is selected and shown, as it is in a browser's find. */
  const showCurrent = () => { if (stateOf().matches.length) select(stateOf().current); };
  /** The marks at the match's start: replacing never changes what the text around it was written with. */
  const insert = (tr: Transaction, match: FindMatch, text: string) => {
    if (!text) { tr.delete(match.from, match.to); return; }
    const marks = tr.doc.resolve(match.from).nodeAfter?.marks ?? [];
    tr.replaceWith(match.from, match.to, tr.doc.type.schema.text(text, marks));
  };
  /** One transaction, closed off from the history group on both sides so a quick edit next to it is not merged in. */
  const commit = (change: (tr: Transaction) => void) => {
    if (!view) return;
    view.dispatch(closeHistory(view.state.tr));
    const tr = view.state.tr;
    change(tr);
    view.dispatch(closeHistory(tr));
    view.dispatch(closeHistory(view.state.tr));
  };

  const controller: FindController = {
    mount,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => snapshot,
    open(options) {
      if (!view) return;
      ensureMounted();
      const { selection, doc } = view.state;
      let query: string | undefined;
      // With the bar open, Mod-F refocuses the query the writer typed rather than overwriting it.
      if (!selection.empty && !stateOf().open) {
        const text = doc.textBetween(selection.from, selection.to, "\n", BARRIER);
        if (text.length <= PREFILL_LIMIT && !/[\n￼]/.test(text)) query = text;
      }
      if (options?.replace) replaceOpen = true;
      focusToken += 1;
      notice = "";
      dispatchMeta({ open: true, ...(query === undefined ? {} : { query }) });
      refresh();
    },
    close() {
      if (!view || !stateOf().open) return;
      const match = stateOf().matches[stateOf().current];
      const tr = view.state.tr.setMeta(key, { open: false } satisfies FindMeta);
      if (match) tr.setSelection(TextSelection.create(view.state.doc, match.to)).scrollIntoView();
      notice = "";
      view.dispatch(tr);
      view.focus();
      refresh();
    },
    setQuery(query) { notice = ""; dispatchMeta({ query }); showCurrent(); refresh(); },
    setMatchCase(matchCase) { notice = ""; dispatchMeta({ matchCase }); showCurrent(); refresh(); },
    setReplaceOpen(open) { replaceOpen = open; refresh(); },
    step(direction) {
      const { matches, current } = stateOf();
      if (!matches.length) return;
      notice = "";
      select((current + direction + matches.length) % matches.length);
      refresh();
    },
    replace(text) {
      if (!view?.editable) return;
      const match = stateOf().matches[stateOf().current];
      if (!match) return;
      notice = "";
      commit(tr => { insert(tr, match, text); tr.setMeta(key, { after: match.from + text.length } satisfies FindMeta); });
      if (stateOf().matches.length) select(stateOf().current);
      refresh();
    },
    replaceAll(text) {
      if (!view?.editable) return;
      const { matches, truncated } = stateOf();
      if (!matches.length) return;
      commit(tr => { for (let index = matches.length - 1; index >= 0; index -= 1) insert(tr, matches[index], text); });
      notice = `Replaced ${matches.length}${truncated ? ", more remain" : ""}`;
      refresh();
    },
  };

  const plugin = $prose(() => new Plugin<FindState>({
    key,
    state: {
      init: () => idle,
      apply(tr, previous, _old, state) {
        const meta = tr.getMeta(key) as FindMeta | undefined;
        const search = meta?.open !== undefined || meta?.query !== undefined || meta?.matchCase !== undefined;
        let next = previous;
        if (meta) next = { ...previous, open: meta.open ?? previous.open, query: meta.query ?? previous.query, matchCase: meta.matchCase ?? previous.matchCase };
        if (!next.open || !next.query) return next.matches.length || next.current ? { ...next, matches: [], truncated: false, current: 0 } : next;
        if (!search && !tr.docChanged) return meta?.current === undefined ? next : { ...next, current: Math.min(meta.current, Math.max(0, next.matches.length - 1)) };
        const { matches, truncated } = findMatches(state.doc, next.query, next.matchCase);
        let current: number;
        if (meta?.current !== undefined) current = Math.min(meta.current, Math.max(0, matches.length - 1));
        else if (meta?.after !== undefined) current = firstFrom(matches, meta.after);
        else if (search) current = firstFrom(matches, state.selection.from);
        else current = firstFrom(matches, tr.mapping.map(previous.matches[previous.current]?.from ?? 0));
        return { ...next, matches, truncated, current };
      },
    },
    props: {
      decorations(state) {
        const find = key.getState(state);
        if (!find?.open || !find.matches.length) return null;
        return DecorationSet.create(state.doc, find.matches.map((match, index) => Decoration.inline(match.from, match.to, { class: index === find.current ? "kh-find-match kh-find-current" : "kh-find-match" })));
      },
      handleKeyDown(_view, event) {
        const action = findKeyAction(event, stateOf().open);
        if (!action) return false;
        event.preventDefault();
        if (action === "next" || action === "previous") controller.step(action === "next" ? 1 : -1);
        else controller.open({ replace: action === "openReplace" });
        return true;
      },
    },
    view: (editorView) => {
      view = editorView;
      ensureMounted();
      refresh();
      return {
        update: refresh,
        // A whole-document replace recreates plugin views; React's subscription must outlive this one.
        destroy() { mount.remove(); view = null; },
      };
    },
  }));

  return { plugin, controller };
}

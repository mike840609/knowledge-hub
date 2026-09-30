import { editorViewOptionsCtx } from "@milkdown/kit/core";
import type { Ctx, MilkdownPlugin } from "@milkdown/kit/ctx";
import { closeHistory } from "@milkdown/kit/prose/history";
import { Plugin, PluginKey, type EditorState } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import type { LinkTargetView } from "@/modules/knowledge/application/knowledge-link-service";
import { createSuggestPopup, type SuggestMessage } from "./link-suggest-popup";
import { findWikiLinkTrigger, rankSuggestions, type Suggestion } from "./link-suggestions";
import { keepsAsText } from "./wiki-link";

/** How long a fetched list is trusted while someone is typing links (spec §6.1). */
export const TARGETS_REFRESH_MS = 60_000;
/** After a failed fetch, how long before the next keystroke tries again. */
export const TARGETS_RETRY_MS = 5_000;

export type LinkTargetsResult = { targets: readonly LinkTargetView[]; truncated: boolean };

export type WikiLinkSuggestOptions = {
  /** Fetches the documents a link can go to. Called the first time a `[[` is typed, then at most once a minute. */
  loadTargets: () => Promise<LinkTargetsResult>;
  /** The document being written, when it exists: a link to itself is never what `[[` is for. */
  excludeDocumentId?: () => string | undefined;
  now?: () => number;
};

type Trigger = { from: number; to: number; query: string };
type SuggestState = {
  trigger: Trigger | null;
  /** Where the `[[` was when Esc was pressed; while the trigger is still there, the list stays closed. */
  dismissed: number | null;
  index: number;
};
type SuggestMeta = { dismiss?: true; index?: number };

/**
 * The link being written at the caret, as a document range: `[[` to the caret, and what was typed
 * after it. Not in code (a block or a mark) and not in a link — the places `[[` is text, not the
 * start of a wikilink — which is the rule the input rule and the paste transform already keep.
 */
function detect(state: EditorState): Trigger | null {
  const { selection } = state;
  if (!selection.empty) return null;
  const { $from } = selection;
  const parent = $from.parent;
  if (!parent.isTextblock || parent.type.spec.code === true) return null;
  if ((state.storedMarks ?? $from.marks()).some(keepsAsText)) return null;
  // A leaf (a wikilink already made, a line break) counts as one character that no query can hold, so
  // text offsets and document positions stay one to one.
  const before = parent.textBetween(0, $from.parentOffset, undefined, "\n");
  const found = findWikiLinkTrigger(before);
  if (!found) return null;
  const from = $from.start() + found.from;
  // `textBetween` omits mark boundaries: brackets in earlier code or link text
  // must not become a trigger merely because the caret is outside that mark.
  let protectedText = false;
  state.doc.nodesBetween(from, $from.pos, (node) => {
    if (node.marks.some(keepsAsText)) protectedText = true;
  });
  return protectedText ? null : { from, to: $from.pos, query: found.query };
}

/**
 * The `[[` list of the rendered editor (daily-driver spec §6.1): the documents of the Workspace
 * that fit what has been typed, chosen with the arrow keys and Enter or Tab (or a click), and put
 * into the document as a `wiki_link` node — the same node the input rule makes, so what is saved is
 * what was typed by hand.
 *
 * Its keys have to be claimed before the editor's own keymaps see them (Enter would split a list
 * item, Tab would sink it), which a plugin's `handleKeyDown` cannot do; they go in as the editor's
 * direct `handleKeyDown` through `configure`, wrapping what is there.
 *
 * It only offers. It writes nothing but the link the person picked, it grants no read of any
 * document it lists, and when it cannot fetch the list it says so and lets typing carry on.
 */
export function wikiLinkSuggest(options: WikiLinkSuggestOptions): { plugins: MilkdownPlugin[]; configure: (ctx: Ctx) => void } {
  const now = options.now ?? (() => Date.now());
  const key = new PluginKey<SuggestState>("khWikiLinkSuggest");

  // The list of documents, shared by everything this editor does.
  let targets: readonly LinkTargetView[] | null = null;
  let truncated = false;
  let loadedAt = 0;
  let failedAt: number | null = null;
  let loading = false;
  const listeners = new Set<() => void>();

  function ensureTargets() {
    if (loading) return;
    const fresh = targets !== null && now() - loadedAt < TARGETS_REFRESH_MS;
    if (fresh) return;
    if (failedAt !== null && now() - failedAt < TARGETS_RETRY_MS) return;
    loading = true;
    options.loadTargets().then(
      (result) => {
        targets = result.targets;
        truncated = result.truncated;
        loadedAt = now();
        failedAt = null;
      },
      () => {
        // A list that was fetched once is still worth offering; only having none is a failure to say.
        failedAt = now();
      },
    ).finally(() => {
      loading = false;
      listeners.forEach((listener) => listener());
    });
  }

  /** What the list holds right now, and why when it holds nothing. */
  function suggestionsFor(query: string): { suggestions: Suggestion[]; message: SuggestMessage | null } {
    if (targets === null) return { suggestions: [], message: failedAt !== null ? { kind: "failed" } : { kind: "loading" } };
    const skip = options.excludeDocumentId?.();
    const suggestions = rankSuggestions(skip ? targets.filter((target) => target.documentId !== skip) : targets, query);
    return { suggestions, message: suggestions.length === 0 ? { kind: "empty", searched: targets.length, cut: truncated } : null };
  }

  const isOpen = (state: SuggestState | undefined): state is SuggestState & { trigger: Trigger } =>
    Boolean(state?.trigger) && state!.dismissed !== state!.trigger!.from;

  // What the view last showed, for the keys: they act on the list the person is looking at.
  let shown: { suggestions: readonly Suggestion[]; visible: boolean } = { suggestions: [], visible: false };

  function choose(view: EditorView, suggestion: Suggestion) {
    const state = key.getState(view.state);
    const type = view.state.schema.nodes.wiki_link;
    if (!isOpen(state) || !type) return;
    const node = type.create({ raw: suggestion.link });
    // The caret was at the end of what is replaced, so it ends up after the link.
    const transaction = view.state.tr.replaceWith(state.trigger.from, state.trigger.to, node);
    // Its own undo step: Undo takes back the pick and leaves what was typed, not everything typed before it.
    view.dispatch(closeHistory(transaction).scrollIntoView());
    // Following prose is another step even when typed immediately after the pick.
    view.dispatch(closeHistory(view.state.tr));
    view.focus();
  }

  const plugin = $prose(
    () =>
      new Plugin<SuggestState>({
        key,
        state: {
          init: () => ({ trigger: null, dismissed: null, index: 0 }),
          apply: (transaction, previous, _before, after) => {
            const trigger = detect(after);
            const meta = transaction.getMeta(key) as SuggestMeta | undefined;
            let dismissed = previous.dismissed === null ? null : transaction.mapping.map(previous.dismissed);
            if (trigger === null) dismissed = null;
            if (meta?.dismiss && trigger) dismissed = trigger.from;
            const sameQuery = trigger !== null && previous.trigger !== null && trigger.query === previous.trigger.query;
            const index = meta?.index ?? (sameQuery ? previous.index : 0);
            return { trigger, dismissed, index };
          },
        },
        view: (editorView) => {
          const popup = createSuggestPopup();
          const dom = editorView.dom;
          // Attributes the editor's element had before the list took it over, put back when it closes.
          const restored = new Map<string, string | null>();
          const setAria = (values: Record<string, string> | null) => {
            for (const name of ["role", "aria-haspopup", "aria-autocomplete", "aria-expanded", "aria-controls", "aria-activedescendant"]) {
              if (!restored.has(name)) restored.set(name, dom.getAttribute(name));
              const value = values?.[name];
              if (value !== undefined) dom.setAttribute(name, value);
              else if (restored.get(name) === null) dom.removeAttribute(name);
              else dom.setAttribute(name, restored.get(name)!);
            }
          };
          let focused = editorView.hasFocus();
          let current = editorView;

          let ariaOn = false;
          const close = () => {
            popup.hide();
            shown = { suggestions: [], visible: false };
            if (ariaOn) setAria(null);
            ariaOn = false;
          };

          function sync(view: EditorView) {
            current = view;
            const state = key.getState(view.state);
            if (!isOpen(state) || !view.editable || !focused) {
              close();
              return;
            }
            ensureTargets();
            const { suggestions, message } = suggestionsFor(state.trigger.query);
            const active = suggestions.length === 0 ? 0 : Math.min(state.index, suggestions.length - 1);
            popup.render({ suggestions, message, active }, (index) => {
              const picked = suggestions[index];
              if (picked) choose(current, picked);
            });
            shown = { suggestions, visible: true };
            reposition();
            const open = suggestions.length > 0;
            ariaOn = true;
            setAria({
              role: "combobox",
              "aria-haspopup": "listbox",
              "aria-autocomplete": "list",
              "aria-expanded": String(open),
              ...(open ? { "aria-controls": popup.listboxId, "aria-activedescendant": popup.optionId(active) } : {}),
            });
          }

          function reposition() {
            const state = key.getState(current.state);
            if (!shown.visible || !state?.trigger) return;
            try {
              popup.show(current.coordsAtPos(state.trigger.from));
            } catch {
              // No geometry (a document that is not laid out): the list is where it was, which is still usable.
              popup.show({ left: 0, top: 0, bottom: 0 });
            }
          }

          const onBlur = () => {
            focused = false;
            sync(current);
          };
          const onFocus = () => {
            focused = true;
            sync(current);
          };
          const onMove = () => reposition();
          dom.addEventListener("blur", onBlur);
          dom.addEventListener("focus", onFocus);
          window.addEventListener("scroll", onMove, true);
          window.addEventListener("resize", onMove);
          const onTargets = () => sync(current);
          listeners.add(onTargets);

          return {
            update: (view) => sync(view),
            destroy: () => {
              listeners.delete(onTargets);
              dom.removeEventListener("blur", onBlur);
              dom.removeEventListener("focus", onFocus);
              window.removeEventListener("scroll", onMove, true);
              window.removeEventListener("resize", onMove);
              close();
              popup.destroy();
            },
          };
        },
      }),
  );

  function handleKeyDown(view: EditorView, event: KeyboardEvent): boolean {
    const state = key.getState(view.state);
    // Only while the list is showing: with it closed, every key is the editor's.
    if (!shown.visible || !isOpen(state) || !view.editable) return false;
    // An input method's Enter or arrow picks a candidate; it is not ours.
    if (event.isComposing || event.keyCode === 229) return false;
    if (event.metaKey || event.ctrlKey || event.altKey) return false;
    const count = shown.suggestions.length;
    switch (event.key) {
      case "Escape":
        // The composer leaves the page on Esc; this one only closes the list.
        event.stopPropagation();
        view.dispatch(view.state.tr.setMeta(key, { dismiss: true } satisfies SuggestMeta));
        return true;
      case "ArrowDown":
      case "ArrowUp": {
        if (count === 0 || event.shiftKey) return false;
        const step = event.key === "ArrowDown" ? 1 : -1;
        const index = (Math.min(state.index, count - 1) + step + count) % count;
        view.dispatch(view.state.tr.setMeta(key, { index } satisfies SuggestMeta));
        return true;
      }
      case "Enter":
      case "Tab": {
        if (count === 0 || event.shiftKey) return false;
        choose(view, shown.suggestions[Math.min(state.index, count - 1)]);
        return true;
      }
      default:
        return false;
    }
  }

  return {
    plugins: [plugin],
    configure: (ctx) => {
      ctx.update(editorViewOptionsCtx, (previous) => ({
        ...previous,
        handleKeyDown: (view, event) => handleKeyDown(view, event) || Boolean(previous.handleKeyDown?.(view, event)),
      }));
    },
  };
}

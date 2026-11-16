import { editorViewOptionsCtx } from "@milkdown/kit/core";
import type { Ctx, MilkdownPlugin } from "@milkdown/kit/ctx";
import { InputRule } from "@milkdown/kit/prose/inputrules";
import { closeHistory } from "@milkdown/kit/prose/history";
import { Plugin, PluginKey, type EditorState } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $inputRule, $prose } from "@milkdown/kit/utils";
import { emojiForShortcode, emojiMatches, emojiShortcode, type Emoji } from "@/lib/emoji-catalog";

type Trigger = { from: number; to: number; query: string };
type State = { trigger: Trigger | null; dismissed: number | null; index: number };
const key = new PluginKey<State>("khEmojiSuggest");
let sequence = 0;

/** A colon at the start of a word (or after an opening bracket); not `http://` or `12:30`. */
const TRIGGER = /(^|[\s([{"'“‘]|\p{Script=Han}):([\p{L}\p{N}_+-]{2,40})$/u;
const CODE_MARKS = new Set(["inlineCode", "code_inline"]);

function inCode(state: EditorState): boolean {
  const { $from } = state.selection;
  if ($from.parent.type.spec.code) return true;
  return (state.storedMarks ?? $from.marks()).some((mark) => CODE_MARKS.has(mark.type.name));
}

/**
 * The `:shortcode` list of the rendered editor, Notion's habit for an emoji mid-sentence. Typing
 * `:` after a word boundary and two or more letters offers the bundled catalog; Enter, Tab or a
 * click inserts the glyph, Escape closes. A fully typed `:name:` converts on the space after it.
 *
 * The keys go through the editor's direct `handleKeyDown`, as the `[[` list's do: Enter and Tab
 * would otherwise split a block or sink a list item before a plugin's keymap sees them.
 */
export function emojiSuggest(): { plugins: MilkdownPlugin[]; configure: (ctx: Ctx) => void } {
  let visible = false;
  let shown: readonly Emoji[] = [];

  function choose(view: EditorView, emoji: Emoji) {
    const state = key.getState(view.state);
    if (!state?.trigger || !view.editable) return;
    const { from, to } = state.trigger;
    // The caret sat at `to`; replacing the trigger leaves it after the glyph.
    view.dispatch(closeHistory(view.state.tr.insertText(emoji.char, from, to)).scrollIntoView());
    view.focus();
  }

  const plugin = $prose(() => new Plugin<State>({
    key,
    state: {
      init: () => ({ trigger: null, dismissed: null, index: 0 }),
      apply(transaction, previous, _before, after) {
        const trigger = detect(after);
        const meta = transaction.getMeta(key) as { dismiss?: true; index?: number } | undefined;
        if (trigger === null) return { trigger: null, dismissed: null, index: 0 };
        const changed = !previous.trigger || previous.trigger.query !== trigger.query;
        return {
          trigger,
          dismissed: meta?.dismiss ? trigger.from : previous.dismissed === null ? null : transaction.mapping.map(previous.dismissed),
          index: meta?.index ?? (changed ? 0 : Math.min(previous.index, Math.max(0, emojiMatches(trigger.query).length - 1))),
        };
      },
    },
    view(view) {
      const popup = document.createElement("div");
      popup.id = `kh-emoji-${++sequence}`;
      popup.className = "kh-emoji-menu";
      popup.hidden = true;
      popup.setAttribute("role", "listbox");
      popup.setAttribute("aria-label", "Emoji");
      document.body.appendChild(popup);
      const dom = view.dom;
      const restored = new Map<string, string | null>();
      const attrs = ["role", "aria-haspopup", "aria-autocomplete", "aria-expanded", "aria-controls", "aria-activedescendant"];
      let ownsAria = false;

      function close() {
        visible = false;
        popup.hidden = true;
        if (ownsAria && dom.getAttribute("aria-controls") === popup.id) {
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
        } catch { /* no layout (jsdom): the row still works from the keyboard */ }
      }

      function sync() {
        const state = key.getState(view.state);
        const trigger = state?.trigger ?? null;
        const dismissed = trigger !== null && state?.dismissed === trigger.from;
        shown = trigger && !dismissed ? emojiMatches(trigger.query) : [];
        if (!view.editable || !view.hasFocus() || !trigger || dismissed || shown.length === 0 || view.composing) { close(); return; }
        const active = Math.min(state!.index, shown.length - 1);
        popup.replaceChildren();
        shown.forEach((entry, index) => {
          const row = document.createElement("div");
          row.id = `${popup.id}-${index}`;
          row.setAttribute("role", "option");
          row.setAttribute("aria-selected", String(index === active));
          row.className = "kh-emoji-option";
          const glyph = document.createElement("span");
          glyph.className = "text-body";
          glyph.textContent = entry.char;
          const name = document.createElement("span");
          name.className = "min-w-0 flex-1 truncate";
          name.textContent = entry.name;
          const code = document.createElement("span");
          code.className = "text-caption text-kh-text-muted";
          code.textContent = `:${emojiShortcode(entry)}:`;
          row.append(glyph, name, code);
          row.addEventListener("mousedown", (event) => { if (event.button === 0) { event.preventDefault(); choose(view, entry); } });
          popup.appendChild(row);
        });
        popup.hidden = false;
        visible = true;
        if (!ownsAria) { for (const name of attrs) restored.set(name, dom.getAttribute(name)); ownsAria = true; }
        dom.setAttribute("role", "combobox");
        dom.setAttribute("aria-haspopup", "listbox");
        dom.setAttribute("aria-autocomplete", "list");
        dom.setAttribute("aria-expanded", "true");
        dom.setAttribute("aria-controls", popup.id);
        if (active >= 0) dom.setAttribute("aria-activedescendant", `${popup.id}-${active}`); else dom.removeAttribute("aria-activedescendant");
        position();
        popup.children[active]?.scrollIntoView?.({ block: "nearest" });
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
      return {
        update: sync,
        destroy() {
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

  // A fully typed `:name:` converts when the space is typed, as Notion's does. The boundary and
  // the space stay; only the code inside them becomes the glyph.
  const inputRule = $inputRule(() => new InputRule(/(?:^|[\s([{"'“‘]|\p{Script=Han})(:[\p{L}\p{N}_+-]{2,40}:)\s$/u, (state, match, start) => {
    if (inCode(state)) return null;
    const emoji = emojiForShortcode(match[1].slice(1, -1));
    if (!emoji) return null;
    const from = start + match[0].indexOf(":");
    // The typed space never reached the document: returning a transaction suppresses it. Insert the
    // glyph and the space together, as its own undo step.
    return closeHistory(state.tr.insertText(`${emoji.char} `, from, from + match[1].length));
  }));

  return {
    plugins: [plugin, inputRule],
    configure(ctx) {
      ctx.update(editorViewOptionsCtx, (previous) => ({
        ...previous,
        handleKeyDown(view, event) {
          if (!visible || !view.editable || event.isComposing || event.keyCode === 229) return Boolean(previous.handleKeyDown?.(view, event));
          if (event.metaKey || event.ctrlKey || event.altKey) return Boolean(previous.handleKeyDown?.(view, event));
          const state = key.getState(view.state);
          if (!state?.trigger) return Boolean(previous.handleKeyDown?.(view, event));
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const count = shown.length;
            const index = (state.index + (event.key === "ArrowDown" ? 1 : -1) + count) % count;
            view.dispatch(view.state.tr.setMeta(key, { index }));
            return true;
          }
          if ((event.key === "Enter" || event.key === "Tab") && !event.shiftKey) {
            event.preventDefault();
            choose(view, shown[Math.min(state.index, shown.length - 1)]);
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
  if (!parent.isTextblock || inCode(state)) return null;
  // Only the end of a huge pasted paragraph can hold a trigger; do not rebuild all of it per key.
  const offset = Math.max(0, $from.parentOffset - 40);
  const before = parent.textBetween(offset, $from.parentOffset, undefined, "\n");
  const found = TRIGGER.exec(before);
  if (!found) return null;
  const from = $from.start() + offset + before.length - found[2].length - 1;
  // `textBetween` drops mark boundaries: the caret can sit just after an inline-code span while
  // the code itself is the query. Look at the range, as the `[[` list does.
  let protectedText = false;
  state.doc.nodesBetween(from, $from.pos, (node) => {
    if (node.marks.some((mark) => CODE_MARKS.has(mark.type.name))) protectedText = true;
  });
  return protectedText ? null : { from, to: $from.pos, query: found[2] };
}

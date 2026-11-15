import { editorViewOptionsCtx } from "@milkdown/kit/core";
import type { Ctx, MilkdownPlugin } from "@milkdown/kit/ctx";
import { Plugin, PluginKey, type EditorState } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet, type EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import { Code, Heading1, Heading2, Heading3, Info, List, ListCollapse, ListOrdered, ListTodo, Minus, Quote, Table, Type, type LucideIcon } from "lucide-react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { dispatchBlockAction } from "./block-actions";
import { insertDetailsSkeleton } from "./details-toggle";

// `aliases` match by prefix (what a Notion hand types: /h2, /todo, /ul); label and `words` match anywhere.
const commands = [
  { id: "text", label: "Text", hint: "Plain paragraph", words: "paragraph 文字 段落", aliases: ["p"], Icon: Type },
  { id: "h1", label: "Heading 1", hint: "Large heading", words: "title 標題", aliases: ["h1"], Icon: Heading1 },
  { id: "h2", label: "Heading 2", hint: "Section heading", words: "title 標題", aliases: ["h2"], Icon: Heading2 },
  { id: "h3", label: "Heading 3", hint: "Small heading", words: "title 標題", aliases: ["h3"], Icon: Heading3 },
  { id: "bullet", label: "Bulleted list", hint: "Unordered items", words: "list 清單", aliases: ["ul", "bullet"], Icon: List },
  { id: "ordered", label: "Numbered list", hint: "Ordered steps", words: "list 清單", aliases: ["ol", "number"], Icon: ListOrdered },
  { id: "task", label: "To-do list", hint: "Tasks with checkboxes", words: "task checklist 待辦", aliases: ["todo", "checkbox"], Icon: ListTodo },
  { id: "quote", label: "Quote", hint: "A block quotation", words: "blockquote 引用", aliases: ["quote"], Icon: Quote },
  { id: "code", label: "Code", hint: "A fenced code block", words: "程式碼", aliases: ["code"], Icon: Code },
  { id: "divider", label: "Divider", hint: "A horizontal rule", words: "hr line 分隔線", aliases: ["hr", "line"], Icon: Minus },
  { id: "table", label: "Table", hint: "A simple 2×2 table", words: "table 表格", aliases: ["table"], Icon: Table },
  { id: "toggle", label: "Toggle", hint: "A collapsible section", words: "toggle fold collapsible 折疊", aliases: ["toggle"], Icon: ListCollapse },
  // The reader's callout glyph for a note (markdown-callout.tsx).
  { id: "callout", label: "Callout", hint: "A highlighted note", words: "callout note 提示 標註", aliases: ["callout"], Icon: Info },
] as const;
type Command = typeof commands[number];
type Trigger = { pos: number; query: string };
/** `armed`: the empty paragraph `+` made, whose list is open as if "/" had been typed there (spec decision 15). */
type State = { trigger: Trigger | null; dismissed: number | null; index: number; armed: number | null };
const OPEN = "khOpenBlockList";
let sequence = 0;

function detect(state: EditorState): Trigger | null {
  const { $from, empty } = state.selection;
  if (!empty || $from.depth !== 1 || $from.parent.type.name !== "paragraph" || $from.parentOffset !== $from.parent.content.size) return null;
  if ($from.parent.childCount !== 1 || !$from.parent.firstChild?.isText || $from.parent.firstChild.marks.length) return null;
  const match = /^\/([^/\n]{0,40})$/.exec($from.parent.textContent);
  return match ? { pos: $from.before(1), query: match[1].toLowerCase().trim() } : null;
}
/** The armed paragraph's query: its own text, with no "/" in front, while the caret is at its end. */
function armedTrigger(state: EditorState, pos: number): Trigger | null {
  const { $from, empty } = state.selection;
  if (!empty || $from.depth !== 1 || $from.before(1) !== pos || $from.parent.type.name !== "paragraph" || $from.parentOffset !== $from.parent.content.size) return null;
  const first = $from.parent.firstChild;
  if ($from.parent.childCount > 1 || (first && (!first.isText || first.marks.length))) return null;
  const match = /^([^/\n]{0,40})$/.exec($from.parent.textContent);
  return match ? { pos, query: match[1].toLowerCase().trim() } : null;
}

/** Opens the list on the empty paragraph the caret is in, with nothing typed: what `+` does after inserting one. */
export function openBlockList(view: EditorView) {
  view.dispatch(view.state.tr.setMeta(OPEN, true));
}

/** Rows for a query, case-insensitively: an alias it begins comes first, then label or `words` holding it, each in list order. */
export function matchingCommands(query: string): readonly Command[] {
  const q = query.toLowerCase().trim();
  const byAlias = commands.filter(command => command.aliases.some(alias => alias.startsWith(q)));
  const byWords = commands.filter(command => !byAlias.includes(command) && `${command.label} ${command.words}`.toLowerCase().includes(q));
  return [...byAlias, ...byWords];
}

/** Each row's 16px Lucide glyph, drawn once from lucide-react as reader-hints.ts draws a callout's, then cloned. */
const glyphs = new Map<LucideIcon, SVGElement>();
function glyph(Icon: LucideIcon): SVGElement {
  let svg = glyphs.get(Icon);
  if (!svg) {
    const markup = renderToStaticMarkup(createElement(Icon, { "aria-hidden": true, className: "size-4 shrink-0 text-kh-text-muted" }));
    svg = new DOMParser().parseFromString(markup, "image/svg+xml").documentElement as unknown as SVGElement;
    glyphs.set(Icon, svg);
  }
  return document.importNode(svg, true);
}

export function slashCommands(): { plugins: MilkdownPlugin[]; configure: (ctx: Ctx) => void } {
  const key = new PluginKey<State>("khSlashCommands");
  let visible = false;
  let shown: readonly Command[] = [];

  function choose(view: EditorView, command: Command) {
    const trigger = key.getState(view.state)?.trigger;
    if (!view.editable || !trigger) return;
    const { nodes } = view.state.schema;
    const paragraph = nodes.paragraph.create();
    let node = paragraph;
    if (command.id.startsWith("h")) node = nodes.heading.create({ level: Number(command.id.slice(1)) });
    if (command.id === "quote") node = nodes.blockquote.create(null, paragraph);
    if (command.id === "code") node = nodes.code_block.create();
    if (command.id === "bullet" || command.id === "ordered" || command.id === "task") {
      const ordered = command.id === "ordered";
      const item = nodes.list_item.create({ listType: ordered ? "ordered" : "bullet", label: ordered ? "1." : "-", ...(command.id === "task" ? { checked: false } : {}) }, paragraph);
      node = (ordered ? nodes.ordered_list : nodes.bullet_list).create(ordered ? { order: 1 } : null, item);
    }
    if (command.id === "table") {
      const cell = () => nodes.table_cell.create(null, nodes.paragraph.create());
      const header = () => nodes.table_header.create(null, nodes.paragraph.create());
      node = nodes.table.create(null, [
        nodes.table_header_row.create(null, [header(), header()]),
        nodes.table_row.create(null, [cell(), cell()]),
      ]);
    }
    const current = view.state.doc.nodeAt(trigger.pos)!;
    if (command.id === "toggle") {
      insertDetailsSkeleton(view, trigger.pos, trigger.pos + current.nodeSize, "", "summary");
      return;
    }
    let caret = trigger.pos + 1;
    if (command.id === "callout") {
      // The marker must stand alone on the quote's first line (remark-callouts), so the body is its own paragraph.
      const marker = nodes.paragraph.create(null, view.state.schema.text("[!NOTE]"));
      node = nodes.blockquote.create(null, [marker, paragraph]);
      caret = trigger.pos + 1 + marker.nodeSize + 1;
    }
    const replacement = command.id === "divider" ? [nodes.hr.create(), paragraph] : node;
    const transaction = view.state.tr.replaceWith(trigger.pos, trigger.pos + current.nodeSize, replacement);
    dispatchBlockAction(view, transaction, command.id === "divider" ? trigger.pos + 2 : caret);
  }

  const plugin = $prose(() => new Plugin<State>({
    key,
    state: {
      init: () => ({ trigger: null, dismissed: null, index: 0, armed: null }),
      apply(transaction, previous, _old, state) {
        const meta = transaction.getMeta(key) as { dismiss?: boolean; disarm?: boolean; index?: number } | undefined;
        let armed = previous.armed === null ? null : transaction.mapping.map(previous.armed);
        if (transaction.getMeta(OPEN)) {
          const { $from, empty } = state.selection;
          armed = empty && $from.depth === 1 && $from.parent.type.name === "paragraph" && $from.parent.content.size === 0 ? $from.before(1) : null;
        }
        if (meta?.dismiss || meta?.disarm) armed = null;
        const typed = detect(state);
        const armedHere = armed === null ? null : armedTrigger(state, armed);
        // Armed, the list goes once nothing matches (the paragraph is being written, not searched) or the caret leaves.
        if (armed !== null && (armedHere ? !matchingCommands(armedHere.query).length : typed?.pos !== armed)) armed = null;
        const trigger = typed ?? (armed === null ? null : armedHere);
        const dismissed = meta?.dismiss && trigger ? trigger.pos : !trigger ? null : previous.dismissed === null ? null : transaction.mapping.map(previous.dismissed);
        return { trigger, dismissed, armed, index: meta?.index ?? (trigger?.query === previous.trigger?.query ? previous.index : 0) };
      },
    },
    props: {
      decorations(state) {
        const { $from, empty } = state.selection;
        if (!empty || $from.depth !== 1 || $from.parent.type.name !== "paragraph" || $from.parent.content.size) return null;
        return DecorationSet.create(state.doc, [Decoration.node($from.before(1), $from.after(1), { "data-placeholder": key.getState(state)?.armed === $from.before(1) ? "Type to filter" : 'Type "/" for commands' })]);
      },
    },
    view(view) {
      const popup = document.createElement("div");
      popup.className = "kh-slash-menu";
      popup.hidden = true;
      popup.id = `kh-slash-${++sequence}`;
      popup.setAttribute("role", "listbox");
      popup.setAttribute("aria-label", "Block commands");
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
        const rect = view.coordsAtPos(trigger.pos + 1);
        const height = popup.offsetHeight;
        const below = window.innerHeight - rect.bottom - 8;
        popup.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - popup.offsetWidth - 8))}px`;
        popup.style.top = `${Math.max(8, below >= height ? rect.bottom + 4 : rect.top - height - 4)}px`;
      }
      function sync() {
        const state = key.getState(view.state);
        if (!view.editable || !view.hasFocus() || !state?.trigger || state.dismissed === state.trigger.pos || view.composing) { close(); return; }
        shown = matchingCommands(state.trigger.query);
        const active = Math.min(state.index, shown.length - 1);
        popup.replaceChildren();
        shown.forEach((command, index) => {
          const row = document.createElement("div");
          row.id = `${popup.id}-${index}`;
          row.setAttribute("role", "option");
          row.setAttribute("aria-selected", String(index === active));
          row.className = "kh-slash-option";
          const text = document.createElement("span"); text.className = "flex min-w-0 flex-col";
          const label = document.createElement("span"); label.textContent = command.label;
          const hint = document.createElement("span"); hint.className = "text-caption text-kh-text-muted"; hint.textContent = command.hint;
          text.append(label, hint);
          row.append(glyph(command.Icon), text);
          row.addEventListener("mousedown", event => { if (event.button === 0) { event.preventDefault(); choose(view, command); } });
          popup.appendChild(row);
        });
        if (!shown.length) {
          const message = document.createElement("div"); message.className = "px-3 py-2 text-body-sm text-kh-text-muted"; message.textContent = "No matching commands"; popup.appendChild(message);
        }
        popup.hidden = false;
        visible = true;
        if (!ownsAria) { for (const name of attrs) restored.set(name, dom.getAttribute(name)); ownsAria = true; }
        dom.setAttribute("role", "combobox"); dom.setAttribute("aria-haspopup", "listbox"); dom.setAttribute("aria-autocomplete", "list"); dom.setAttribute("aria-expanded", "true"); dom.setAttribute("aria-controls", popup.id);
        if (active >= 0) dom.setAttribute("aria-activedescendant", `${popup.id}-${active}`); else dom.removeAttribute("aria-activedescendant");
        position();
        popup.children[active]?.scrollIntoView?.({ block: "nearest" });
      }
      const keepCaret = (event: MouseEvent) => { if (event.button === 0) event.preventDefault(); };
      popup.addEventListener("mousedown", keepCaret);
      // Leaving the editor dismisses a list `+` opened, as Escape does: coming back to the empty line does not reopen it.
      const blur = () => { close(); if (key.getState(view.state)?.armed != null) view.dispatch(view.state.tr.setMeta(key, { disarm: true })); };
      dom.addEventListener("focus", sync); dom.addEventListener("blur", blur);
      dom.addEventListener("compositionstart", close); dom.addEventListener("compositionend", sync);
      window.addEventListener("scroll", position, true); window.addEventListener("resize", position);
      return { update: sync, destroy() {
        close(); popup.remove();
        dom.removeEventListener("focus", sync); dom.removeEventListener("blur", blur);
        dom.removeEventListener("compositionstart", close); dom.removeEventListener("compositionend", sync);
        window.removeEventListener("scroll", position, true); window.removeEventListener("resize", position);
      } };
    },
  }));
  return { plugins: [plugin], configure(ctx) {
    ctx.update(editorViewOptionsCtx, previous => ({ ...previous, handleKeyDown(view, event) {
      if (visible && view.editable && !event.isComposing && event.keyCode !== 229 && !event.metaKey && !event.ctrlKey && !event.altKey) {
        const state = key.getState(view.state)!;
        if (event.key === "Escape") { event.stopPropagation(); view.dispatch(view.state.tr.setMeta(key, { dismiss: true })); return true; }
        if (shown.length && !event.shiftKey) {
          const active = Math.min(state.index, shown.length - 1);
          if (event.key === "ArrowDown" || event.key === "ArrowUp") { view.dispatch(view.state.tr.setMeta(key, { index: (active + (event.key === "ArrowDown" ? 1 : -1) + shown.length) % shown.length })); return true; }
          if (event.key === "Enter" || event.key === "Tab") { choose(view, shown[active]); return true; }
        }
      }
      return Boolean(previous.handleKeyDown?.(view, event));
    } }));
  } };
}

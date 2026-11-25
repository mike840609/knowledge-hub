import { editorViewOptionsCtx } from "@milkdown/kit/core";
import type { Ctx, MilkdownPlugin } from "@milkdown/kit/ctx";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey, type EditorState } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet, type EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import { CalendarDays, Code, Heading1, Heading2, Heading3, Info, Link2, List, ListCollapse, ListOrdered, ListTodo, Minus, Network, Quote, Table, Type, type LucideIcon } from "lucide-react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { blockKind, canTurnInto, dispatchBlockAction, insertAfterListItem, replaceListItem, turnInto, type BlockKind } from "./block-actions";
import { detailsSkeleton, insertDetailsSkeleton } from "./details-toggle";
import { isoDate } from "./date-text";
import { keepsAsText } from "./wiki-link";

// `aliases` match by prefix (what a Notion hand types: /h2, /todo, /ul); label and `words` match anywhere.
const commands = [
  { id: "text", label: "Text", hint: "Plain paragraph", words: "paragraph 文字 段落", aliases: ["p"], group: "Basic blocks", Icon: Type },
  { id: "h1", label: "Heading 1", hint: "Large heading", words: "title 標題", aliases: ["h1"], group: "Basic blocks", Icon: Heading1 },
  { id: "h2", label: "Heading 2", hint: "Section heading", words: "title 標題", aliases: ["h2"], group: "Basic blocks", Icon: Heading2 },
  { id: "h3", label: "Heading 3", hint: "Small heading", words: "title 標題", aliases: ["h3"], group: "Basic blocks", Icon: Heading3 },
  { id: "bullet", label: "Bulleted list", hint: "Unordered items", words: "list 清單", aliases: ["ul", "bullet"], group: "Lists", Icon: List },
  { id: "ordered", label: "Numbered list", hint: "Ordered steps", words: "list 清單", aliases: ["ol", "number"], group: "Lists", Icon: ListOrdered },
  { id: "task", label: "To-do list", hint: "Tasks with checkboxes", words: "task checklist 待辦", aliases: ["todo", "checkbox"], group: "Lists", Icon: ListTodo },
  { id: "quote", label: "Quote", hint: "A block quotation", words: "blockquote 引用", aliases: ["quote"], group: "Blocks", Icon: Quote },
  { id: "code", label: "Code", hint: "A fenced code block", words: "程式碼", aliases: ["code"], group: "Blocks", Icon: Code },
  { id: "divider", label: "Divider", hint: "A horizontal rule", words: "hr line 分隔線", aliases: ["hr", "line"], group: "Blocks", Icon: Minus },
  { id: "table", label: "Table", hint: "A simple 2×2 table", words: "table 表格", aliases: ["table"], group: "Blocks", Icon: Table },
  { id: "toggle", label: "Toggle", hint: "A collapsible section", words: "toggle fold collapsible 折疊", aliases: ["toggle"], group: "Blocks", Icon: ListCollapse },
  // The reader's callout glyph for a note (markdown-callout.tsx).
  { id: "callout", label: "Callout", hint: "A highlighted note", words: "callout note 提示 標註", aliases: ["callout"], group: "Blocks", Icon: Info },
  // A fenced `mermaid` block: the reader and the code preview already draw it.
  { id: "diagram", label: "Diagram", hint: "A Mermaid diagram", words: "mermaid flowchart chart 圖表 流程圖", aliases: ["mermaid"], group: "Blocks", Icon: Network },
  { id: "date", label: "Today's date", hint: "Writes today's date", words: "today now 日期 今天", aliases: ["date", "today"], group: "Basic blocks", Icon: CalendarDays },
  { id: "link", label: "Page link", hint: "Another page in this workspace", words: "link to page document wiki 連結 頁面", aliases: ["page"], group: "Links", Icon: Link2 },
] as const;
type Command = typeof commands[number];
const RECENT_KEY = "kh-recent-slash-commands";
const RECENT_LIMIT = 4;

function recentCommands(): Command[] {
  try {
    const ids: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    if (!Array.isArray(ids)) return [];
    return [...new Set(ids)].flatMap(id => commands.find(command => command.id === id) ?? []).slice(0, RECENT_LIMIT);
  } catch { return []; }
}

function rememberCommand(command: Command): void {
  const ids = [command, ...recentCommands().filter(old => old !== command)].slice(0, RECENT_LIMIT).map(item => item.id);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(ids)); } catch { /* Slash commands still work without storage. */ }
}

/** The block kind a command turns a block into, where it is one Turn into also offers. */
export const COMMAND_KIND: Partial<Record<Command["id"], BlockKind>> = {
  text: "paragraph", h1: "h1", h2: "h2", h3: "h3", bullet: "bullet", ordered: "ordered", task: "task", quote: "quote", code: "code", toggle: "toggle", callout: "callout",
};
/**
 * `pos`: the paragraph's position; `from`: its "/"; `inline`: the "/" follows text on the line (keys spec, decision 7);
 * `item`: the list item whose first paragraph this is, or null for a top-level paragraph (list commands spec, decision 1).
 */
type Trigger = { pos: number; from: number; query: string; inline: boolean; item: number | null };
/**
 * `added`: the paragraph whose "/" `+` wrote (spec decision 15, deviation), held while its list is open there.
 * Dismissing that list with the "/" alone on the line takes the "/" back; anything typed after it stays.
 */
type State = { trigger: Trigger | null; dismissed: number | null; index: number; added: number | null };
const OPEN = "khOpenBlockList";
const key = new PluginKey<State>("khSlashCommands");
let sequence = 0;

/**
 * Where a "/" may open the list: a top-level paragraph, or a list item's first paragraph, quoted or not (list commands
 * spec, decision 1). The paragraph's position and its item's, or null.
 */
function line(state: EditorState): { pos: number; item: number | null } | null {
  const { $from } = state.selection;
  if ($from.parent.type.name !== "paragraph") return null;
  if ($from.depth === 1) return { pos: $from.before(1), item: null };
  if ($from.node(-1).type.name === "list_item" && $from.index(-1) === 0) return { pos: $from.before(), item: $from.before(-1) };
  return null;
}

function detect(state: EditorState): Trigger | null {
  const { $from, empty } = state.selection;
  const at = empty ? line(state) : null;
  if (!at || $from.parentOffset !== $from.parent.content.size) return null;
  if ($from.parent.childCount !== 1 || !$from.parent.firstChild?.isText || $from.parent.firstChild.marks.length) return null;
  const match = /^\/([^/\n]{0,40})$/.exec($from.parent.textContent);
  // A colon query belongs to the emoji list; both menus must not claim the same line.
  return match && !match[1].includes(":") ? { ...at, from: $from.start(), query: match[1].toLowerCase().trim(), inline: false } : null;
}
/**
 * A "/" after a space later in a line opens the list too, as Notion's does; the chosen block goes below
 * the line, and "/query" is taken out of it. A query nothing matches lets go, so a path typed as text
 * (" /usr") does not keep a list open.
 */
function detectInline(state: EditorState): Trigger | null {
  const { $from, empty } = state.selection;
  const at = empty ? line(state) : null;
  if (!at) return null;
  // Inline code and link text are where a "/" is a path or an address, not a command; other marks are not in its way.
  if ((state.storedMarks ?? $from.marks()).some(keepsAsText)) return null;
  // Marks do not matter to a "/" (after **bold** is as good a place as after plain words), and an inline node
  // (a wikilink, a line break) reads as one character, which is not a word character either.
  const match = /(?:^|[\s\ufffc])\/([^\s/:\ufffc]{0,40})$/.exec($from.parent.textBetween(0, $from.parentOffset, undefined, "\ufffc"));
  if (!match) return null;
  const from = $from.pos - match[1].length - 1;
  if (from === $from.start() || !matchingCommands(match[1]).length) return null;
  return { ...at, from, query: match[1].toLowerCase(), inline: true };
}
/**
 * What `+` does after inserting an empty paragraph or an empty list item, as Notion's does: writes a visible "/" there,
 * so the list opens through the same path a typed "/" takes and what is typed next is that "/"'s query (list commands
 * spec, decision 4). Only where the list is installed.
 */
export function openBlockList(view: EditorView): boolean {
  const { $from, empty } = view.state.selection;
  if (!view.editable || !key.get(view.state) || !empty || !line(view.state) || $from.parent.content.size) return false;
  view.dispatch(view.state.tr.insertText("/").setMeta(OPEN, true));
  return true;
}
/** The lone "/" `+` wrote, still alone on its line: [from, to) to take back, or null. */
function loneSlash(state: EditorState, pos: number): [number, number] | null {
  const node = pos < state.doc.content.size ? state.doc.nodeAt(pos) : null;
  if (node?.type.name !== "paragraph" || node.childCount !== 1 || !node.firstChild!.isText || node.firstChild!.marks.length || node.textContent !== "/") return null;
  return [pos + 1, pos + 2];
}

/**
 * Rows for a query, case-insensitively, each group in list order: an alias it equals, a label it
 * begins, a word of the label or `words` it begins, an alias it begins, then label or `words` holding
 * it. So `/h2` is Heading 2, `/t` is Text rather than To-do by way of `todo`, and `/li` is a list
 * rather than Divider by way of `line`.
 */
export function matchingCommands(query: string): readonly Command[] {
  const q = query.toLowerCase().trim();
  // Rows are shown under one heading each, in this order; the rank inside a group is preserved.
  const order = ["Basic blocks", "Lists", "Blocks", "Links"] as const;
  const groups = [
    (command: Command) => command.aliases.some(alias => alias === q),
    (command: Command) => command.label.toLowerCase().startsWith(q),
    (command: Command) => `${command.label} ${command.words}`.toLowerCase().split(/\s+/).some(word => word.startsWith(q)),
    (command: Command) => command.aliases.some(alias => alias.startsWith(q)),
    (command: Command) => `${command.label} ${command.words}`.toLowerCase().includes(q),
  ];
  const found: Command[] = [];
  for (const test of groups) for (const command of commands) if (!found.includes(command) && test(command)) found.push(command);
  // Each heading appears once, and a group keeps the best rank of its rows: a label prefix in one
  // group still outranks a word match in another, while the rows of one heading stay together.
  const rankOf = (command: Command) => groups.findIndex(test => test(command));
  const orderIndex = (command: Command) => order.indexOf(command.group as typeof order[number]);
  const groupRank = new Map<string, number>();
  for (const command of found) groupRank.set(command.group, Math.min(groupRank.get(command.group) ?? Infinity, rankOf(command)));
  return [...found].sort((a, b) =>
    (groupRank.get(a.group)! - groupRank.get(b.group)!) ||
    (orderIndex(a) - orderIndex(b)) ||
    (rankOf(a) - rankOf(b)) ||
    (found.indexOf(a) - found.indexOf(b)));
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
  let visible = false;
  let shown: readonly Command[] = [];

  function choose(view: EditorView, command: Command) {
    const trigger = key.getState(view.state)?.trigger;
    if (!view.editable || !trigger) return;
    rememberCommand(command);
    const { nodes } = view.state.schema;
    const current = view.state.doc.nodeAt(trigger.pos)!;
    if (command.id === "date") {
      // Text, not a block: today's date goes where the "/query" was (ISO, the way a Markdown note dates a line).
      const date = isoDate();
      const caretAt = view.state.selection.from;
      if (trigger.inline || trigger.item !== null) dispatchBlockAction(view, view.state.tr.insertText(date, trigger.from, caretAt), trigger.from + date.length);
      else dispatchBlockAction(view, view.state.tr.replaceWith(trigger.pos, trigger.pos + current.nodeSize, nodes.paragraph.create(null, view.state.schema.text(date))), trigger.pos + 1 + date.length);
      return;
    }
    if (trigger.item !== null) { chooseInItem(view, command, trigger, trigger.item); return; }
    if (trigger.inline) {
      const caretAt = view.state.selection.from;
      if (command.id === "link") {
        dispatchBlockAction(view, view.state.tr.insertText("[[", trigger.from, caretAt), trigger.from + 2);
        return;
      }
      const tr = view.state.tr.delete(trigger.from, caretAt);
      const below = trigger.pos + current.nodeSize - (caretAt - trigger.from);
      if (command.id === "toggle") { insertDetailsSkeleton(view, below, below, "", "summary", tr); return; }
      const [node, caret] = blockFor(view, command);
      tr.insert(below, node);
      dispatchBlockAction(view, tr, below + caret);
      return;
    }
    if (command.id === "link") {
      // Hand off to the `[[` list that already knows how to write a wikilink: the next thing typed
      // is that link's target, and dismissing it leaves the text as typed.
      const paragraph = nodes.paragraph.create(null, view.state.schema.text("[["));
      dispatchBlockAction(view, view.state.tr.replaceWith(trigger.pos, trigger.pos + current.nodeSize, paragraph), trigger.pos + 3);
      return;
    }
    if (command.id === "toggle") {
      insertDetailsSkeleton(view, trigger.pos, trigger.pos + current.nodeSize, "", "summary");
      return;
    }
    const [node, caret] = blockFor(view, command);
    dispatchBlockAction(view, view.state.tr.replaceWith(trigger.pos, trigger.pos + current.nodeSize, node), trigger.pos + caret);
  }

  /**
   * A choice in a list item (list commands spec, decisions 2 and 3), one transaction: the "/query" goes, then the item
   * turns (with "/query" alone on its line) or the block goes below it, at its level. A page link writes inline.
   */
  function chooseInItem(view: EditorView, command: Command, trigger: Trigger, itemPos: number) {
    const caretAt = view.state.selection.from;
    if (command.id === "link") {
      dispatchBlockAction(view, view.state.tr.insertText("[[", trigger.from, caretAt), trigger.from + 2);
      return;
    }
    const tr = view.state.tr.delete(trigger.from, caretAt);
    const item = tr.doc.nodeAt(itemPos)!;
    const kind = COMMAND_KIND[command.id];
    const [made, offset] = blockFor(view, command);
    // A divider brings an empty line after it, as at the top level, and the caret goes there: the next key neither
    // replaces the divider nor types into the next item.
    const nodes = Array.isArray(made) ? made : [made];
    const caret = offset;
    if (!trigger.inline) {
      // The item's own kind keeps it as it is; another list kind or a leaf turns it as Turn into does.
      if (kind && kind === blockKind(item)) { dispatchBlockAction(view, tr, trigger.from); return; }
      if (kind && canTurnInto(item, kind)) {
        const turned = turnInto(tr, itemPos, kind);
        if (turned !== null) { dispatchBlockAction(view, tr, turned); return; }
      }
      // A block Turn into does not make from an item (a divider, a table, a diagram, a toggle or a callout) replaces it,
      // where that drops nothing: an item with a nested list keeps it, and the block goes below instead.
      if (item.childCount === 1) {
        dispatchBlockAction(view, tr, replaceListItem(tr, itemPos, nodes) + caret);
        return;
      }
    }
    // A list kind adds one item: after this one if it is the same kind (a sibling), else in a list of its own.
    const list = nodes[0].type.name === "bullet_list" || nodes[0].type.name === "ordered_list";
    const at = insertAfterListItem(tr, itemPos, list ? [nodes[0].firstChild!] : nodes);
    // From a sibling item or a new list the caret finds the item's line; any other block gives its own offset.
    dispatchBlockAction(view, tr, at + (list ? 1 : caret));
  }

  /** The block a command makes, with the caret's offset from the block's start. */
  function blockFor(view: EditorView, command: Command): [ProseNode | ProseNode[], number] {
    const { nodes } = view.state.schema;
    const paragraph = nodes.paragraph.create();
    let node = paragraph;
    if (command.id.startsWith("h")) node = nodes.heading.create({ level: Number(command.id.slice(1)) });
    if (command.id === "quote") node = nodes.blockquote.create(null, paragraph);
    if (command.id === "code") node = nodes.code_block.create();
    let caret = 1;
    if (command.id === "diagram") {
      const sample = "flowchart TD\n  A[Start] --> B[Done]";
      node = nodes.code_block.create({ language: "mermaid" }, view.state.schema.text(sample));
      caret = 1 + sample.length;
    }
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
    if (command.id === "toggle") {
      node = detailsSkeleton(view.state.schema);
      caret = 2;
    }
    if (command.id === "callout") {
      // The marker must stand alone on the quote's first line (remark-callouts), so the body is its own paragraph.
      const marker = nodes.paragraph.create(null, view.state.schema.text("[!NOTE]"));
      node = nodes.blockquote.create(null, [marker, paragraph]);
      caret = 1 + marker.nodeSize + 1;
    }
    return command.id === "divider" ? [[nodes.hr.create(), paragraph], 2] : [node, caret];
  }

  const plugin = $prose(() => new Plugin<State>({
    key,
    state: {
      init: () => ({ trigger: null, dismissed: null, index: 0, added: null }),
      apply(transaction, previous, _old, state) {
        const meta = transaction.getMeta(key) as { dismiss?: boolean; release?: boolean; index?: number } | undefined;
        const trigger = detect(state) ?? detectInline(state);
        let added = previous.added === null ? null : transaction.mapping.map(previous.added);
        if (transaction.getMeta(OPEN)) added = trigger?.pos ?? null;
        // Held only while that line's list is open: a dismissal, leaving the editor, or the caret leaving lets it go.
        if (meta?.dismiss || meta?.release || trigger?.pos !== added) added = null;
        const dismissed = meta?.dismiss && trigger ? trigger.from : !trigger ? null : previous.dismissed === null ? null : transaction.mapping.map(previous.dismissed);
        return { trigger, dismissed, added, index: meta?.index ?? (trigger?.query === previous.trigger?.query ? previous.index : 0) };
      },
    },
    // When the list `+` opened is let go with its "/" still alone on the line, the "/" goes too: nothing was written.
    appendTransaction(transactions, old, state) {
      const before = key.getState(old)?.added;
      if (before == null || key.getState(state)?.added != null) return null;
      const range = loneSlash(state, transactions.reduce((pos, transaction) => transaction.mapping.map(pos), before));
      return range ? state.tr.delete(...range).setMeta("addToHistory", false) : null;
    },
    props: {
      decorations(state) {
        const { $from, empty } = state.selection;
        if (!empty || $from.depth !== 1 || $from.parent.type.name !== "paragraph" || $from.parent.content.size) return null;
        return DecorationSet.create(state.doc, [Decoration.node($from.before(1), $from.after(1), { "data-placeholder": 'Type "/" for commands' })]);
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
        const rect = view.coordsAtPos(trigger.from);
        const height = popup.offsetHeight;
        const below = window.innerHeight - rect.bottom - 8;
        popup.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - popup.offsetWidth - 8))}px`;
        popup.style.top = `${Math.max(8, below >= height ? rect.bottom + 4 : rect.top - height - 4)}px`;
      }
      function sync() {
        const state = key.getState(view.state);
        if (!view.editable || !view.hasFocus() || !state?.trigger || state.dismissed === state.trigger.from || view.composing) { close(); return; }
        const recent = state.trigger.query ? [] : recentCommands();
        const matches = matchingCommands(state.trigger.query);
        shown = [...recent, ...matches.filter(command => !recent.includes(command))];
        const active = Math.min(state.index, shown.length - 1);
        popup.replaceChildren();
        const rows: HTMLElement[] = [];
        let group = "";
        shown.forEach((command, index) => {
          const nextGroup = index < recent.length ? "Recent" : command.group;
          if (nextGroup !== group) {
            group = nextGroup;
            const heading = document.createElement("div");
            heading.className = "px-2 pb-1 pt-2 text-caption text-kh-text-muted";
            heading.setAttribute("data-slash-group", group);
            heading.setAttribute("role", "presentation");
            heading.setAttribute("aria-hidden", "true");
            heading.textContent = group;
            popup.appendChild(heading);
          }
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
          rows.push(row);
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
        rows[active]?.scrollIntoView?.({ block: "nearest" });
      }
      const keepCaret = (event: MouseEvent) => { if (event.button === 0) event.preventDefault(); };
      popup.addEventListener("mousedown", keepCaret);
      // Leaving the editor lets go of a list `+` opened: a lone "/" is taken back, a "/query" stays as if typed.
      const blur = () => { close(); if (key.getState(view.state)?.added != null) view.dispatch(view.state.tr.setMeta(key, { release: true })); };
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

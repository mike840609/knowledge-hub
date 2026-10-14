import { editorViewOptionsCtx } from "@milkdown/kit/core";
import type { Ctx, MilkdownPlugin } from "@milkdown/kit/ctx";
import { Plugin, PluginKey, type EditorState } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet, type EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import { dispatchBlockAction } from "./block-actions";
import { insertDetailsSkeleton } from "./details-toggle";

const commands = [
  { id: "text", label: "Text", hint: "Plain paragraph", words: "paragraph 文字 段落" },
  { id: "h1", label: "Heading 1", hint: "Large heading", words: "title 標題" },
  { id: "h2", label: "Heading 2", hint: "Section heading", words: "title 標題" },
  { id: "h3", label: "Heading 3", hint: "Small heading", words: "title 標題" },
  { id: "bullet", label: "Bulleted list", hint: "Unordered items", words: "list 清單" },
  { id: "ordered", label: "Numbered list", hint: "Ordered steps", words: "list 清單" },
  { id: "task", label: "To-do list", hint: "Tasks with checkboxes", words: "task checklist 待辦" },
  { id: "quote", label: "Quote", hint: "A block quotation", words: "blockquote 引用" },
  { id: "code", label: "Code", hint: "A fenced code block", words: "程式碼" },
  { id: "divider", label: "Divider", hint: "A horizontal rule", words: "hr line 分隔線" },
  { id: "table", label: "Table", hint: "A simple 2×2 table", words: "table 表格" },
  { id: "toggle", label: "Toggle", hint: "A collapsible section", words: "toggle fold collapsible 折疊" },
  { id: "callout", label: "Callout", hint: "A highlighted note", words: "callout note 提示 標註" },
] as const;
type Command = typeof commands[number];
type Trigger = { pos: number; query: string };
type State = { trigger: Trigger | null; dismissed: number | null; index: number };
let sequence = 0;

function detect(state: EditorState): Trigger | null {
  const { $from, empty } = state.selection;
  if (!empty || $from.depth !== 1 || $from.parent.type.name !== "paragraph" || $from.parentOffset !== $from.parent.content.size) return null;
  if ($from.parent.childCount !== 1 || !$from.parent.firstChild?.isText || $from.parent.firstChild.marks.length) return null;
  const match = /^\/([^/\n]{0,40})$/.exec($from.parent.textContent);
  return match ? { pos: $from.before(1), query: match[1].toLowerCase().trim() } : null;
}
const matches = (query: string) => commands.filter(command => `${command.label} ${command.words}`.toLowerCase().includes(query));

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
      insertDetailsSkeleton(view, trigger.pos, trigger.pos + current.nodeSize, "");
      return;
    }
    let caret = trigger.pos + 1;
    if (command.id === "callout") {
      const marker = "[!NOTE] ";
      node = nodes.blockquote.create(null, nodes.paragraph.create(null, view.state.schema.text(marker)));
      caret = trigger.pos + 2 + marker.length;
    }
    const replacement = command.id === "divider" ? [nodes.hr.create(), paragraph] : node;
    const transaction = view.state.tr.replaceWith(trigger.pos, trigger.pos + current.nodeSize, replacement);
    dispatchBlockAction(view, transaction, command.id === "divider" ? trigger.pos + 2 : caret);
  }

  const plugin = $prose(() => new Plugin<State>({
    key,
    state: {
      init: () => ({ trigger: null, dismissed: null, index: 0 }),
      apply(transaction, previous, _old, state) {
        const trigger = detect(state);
        const meta = transaction.getMeta(key) as { dismiss?: boolean; index?: number } | undefined;
        const dismissed = meta?.dismiss && trigger ? trigger.pos : !trigger ? null : previous.dismissed === null ? null : transaction.mapping.map(previous.dismissed);
        return { trigger, dismissed, index: meta?.index ?? (trigger?.query === previous.trigger?.query ? previous.index : 0) };
      },
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
        const rect = view.coordsAtPos(trigger.pos + 1);
        const height = popup.offsetHeight;
        const below = window.innerHeight - rect.bottom - 8;
        popup.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - popup.offsetWidth - 8))}px`;
        popup.style.top = `${Math.max(8, below >= height ? rect.bottom + 4 : rect.top - height - 4)}px`;
      }
      function sync() {
        const state = key.getState(view.state);
        if (!view.editable || !view.hasFocus() || !state?.trigger || state.dismissed === state.trigger.pos || view.composing) { close(); return; }
        shown = matches(state.trigger.query);
        const active = Math.min(state.index, shown.length - 1);
        popup.replaceChildren();
        shown.forEach((command, index) => {
          const row = document.createElement("div");
          row.id = `${popup.id}-${index}`;
          row.setAttribute("role", "option");
          row.setAttribute("aria-selected", String(index === active));
          row.className = "kh-slash-option";
          const label = document.createElement("span"); label.textContent = command.label;
          const hint = document.createElement("span"); hint.className = "text-caption text-kh-text-muted"; hint.textContent = command.hint;
          row.append(label, hint);
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
      dom.addEventListener("focus", sync); dom.addEventListener("blur", close);
      dom.addEventListener("compositionstart", close); dom.addEventListener("compositionend", sync);
      window.addEventListener("scroll", position, true); window.addEventListener("resize", position);
      return { update: sync, destroy() {
        close(); popup.remove();
        dom.removeEventListener("focus", sync); dom.removeEventListener("blur", close);
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

import { computePosition, flip, getOverflowAncestors, offset, shift } from "@floating-ui/dom";
import { commandsCtx } from "@milkdown/kit/core";
import type { Ctx, MilkdownPlugin } from "@milkdown/kit/ctx";
import { TooltipProvider, tooltipFactory } from "@milkdown/kit/plugin/tooltip";
import {
  toggleInlineCodeCommand,
  toggleEmphasisCommand,
  toggleLinkCommand,
  toggleStrongCommand,
} from "@milkdown/kit/preset/commonmark";
import { toggleStrikethroughCommand } from "@milkdown/kit/preset/gfm";
import { posToDOMRect } from "@milkdown/kit/prose";
import { closeHistory } from "@milkdown/kit/prose/history";
import { NodeSelection, Plugin, PluginKey, TextSelection, type Transaction } from "@milkdown/kit/prose/state";
import { $prose } from "@milkdown/kit/utils";
import type { Mark, Node as ProseNode } from "@milkdown/kit/prose/model";
import type { EditorView } from "@milkdown/kit/prose/view";
import { buttonClasses } from "@/components/ui/button";
import { fieldClasses } from "@/components/ui/field";
import { blockKind, type BlockKind, type EditorBlock } from "./block-actions";
import { TURN_OPTIONS, turnEntry } from "./block-gutter";
import { blocksTouched, turnBlocks } from "./block-sequence";
import { parseDocumentHref } from "@/modules/knowledge/domain/document-links";
import { linkLookupKey } from "@/modules/knowledge/domain/link-graph";
import type { RenderedLinks } from "../rendered-links";

const tooltip = tooltipFactory("khSelectionToolbar");

function markActive(view: EditorView, name: string): boolean {
  const type = view.state.schema.marks[name];
  if (!type) return false;
  const { from, to, empty, $from } = view.state.selection;
  return empty ? Boolean(type.isInSet(view.state.storedMarks ?? $from.marks())) : view.state.doc.rangeHasMark(from, to, type);
}

/** What Turn into's button reads for `blocks`: their one kind, or Mixed (2026-11-21 list-commands spec, decision 5). */
export function turnLabel(blocks: readonly EditorBlock[]): string {
  const kinds = new Set(blocks.map((block) => blockKind(block.node)));
  if (kinds.size > 1) return "Mixed";
  const [kind] = kinds as Set<BlockKind | undefined>;
  if (kind === "h4" || kind === "h5" || kind === "h6") return `Heading ${kind.slice(1)}`;
  return TURN_OPTIONS.find(([option]) => option === kind)?.[1] ?? "Turn into";
}

/** Every textblock of the document, in order. */
function textblocks(doc: ProseNode): { pos: number; node: ProseNode }[] {
  const found: { pos: number; node: ProseNode }[] = [];
  doc.descendants((node, pos) => {
    if (node.isTextblock) { found.push({ pos, node }); return false; }
    return true;
  });
  return found;
}

/**
 * Where a position in `before` is in `tr.doc` after a turn, by its textblock and its offset in it. A turn replaces
 * whole blocks, so `tr.mapping` sends every position inside them to their edges; the words, though, stay in a
 * textblock of their own. Textblocks the turn left alone match from either end; between those, a turn adds at most a
 * callout's marker line before a block's words or a toggle's empty body after them, or takes a marker line away, so
 * the rest match in order by their text.
 */
function mapThroughTurn(before: ProseNode, after: ProseNode, pos: number): number {
  const old = textblocks(before);
  const now = textblocks(after);
  const index = old.findIndex((block) => pos > block.pos && pos <= block.pos + block.node.nodeSize - 1);
  if (index < 0 || !now.length) return Math.min(pos, after.content.size);
  let head = 0;
  while (head < old.length && head < now.length && old[head].node.eq(now[head].node)) head++;
  let tail = 0;
  while (tail < old.length - head && tail < now.length - head && old[old.length - 1 - tail].node.eq(now[now.length - 1 - tail].node)) tail++;
  const same = (a: ProseNode, b: ProseNode | undefined) => b !== undefined && a.textContent === b.textContent;
  let target: number;
  if (index < head) target = index;
  else if (index >= old.length - tail) target = index + now.length - old.length;
  else {
    const end = now.length - tail;
    let at = head;
    target = head;
    for (let step = head; step <= index; step++) {
      const node = old[step].node;
      if (at < end && same(node, now[at].node)) target = at++;
      else if (at + 1 < end && same(node, now[at + 1].node)) { target = at + 1; at += 2; }
      // A line the turn took away (a callout's marker): its words' neighbour takes its place.
      else if (step + 1 < old.length - tail && at < end && same(old[step + 1].node, now[at].node)) target = at;
      else target = Math.min(at++, end - 1);
      if (step === index) break;
    }
    target = Math.max(0, Math.min(target, now.length - 1));
  }
  const from = old[index];
  const to = now[target];
  const offset = pos - from.pos - 1;
  const lost = from.node.content.size - to.node.content.size;
  // Words kept after a dropped marker (`[!NOTE]` and its break, in one line) keep their place among themselves.
  const shifted = !same(from.node, to.node) && lost > 0 && from.node.textContent.endsWith(to.node.textContent) ? offset - lost : offset;
  return to.pos + 1 + Math.max(0, Math.min(shifted, to.node.content.size));
}

/**
 * Turns the blocks the text selection touches into `kind`, in one undo step, with the same text selected afterwards so a
 * mark can follow (2026-11-21 list-commands spec, decision 6). False when the turn is refused.
 */
function turnSelection(view: EditorView, kind: BlockKind): boolean {
  const { state } = view;
  const blocks = blocksTouched(state);
  if (!view.editable || turnEntry(blocks, kind).disabled) return false;
  const tr: Transaction | null = turnBlocks(state, blocks, kind);
  if (!tr) return false;
  const { anchor, head } = state.selection;
  tr.setSelection(TextSelection.create(tr.doc, mapThroughTurn(state.doc, tr.doc, anchor), mapThroughTurn(state.doc, tr.doc, head)));
  view.dispatch(closeHistory(tr).scrollIntoView());
  // Typing straight after starts an undo step of its own, as after the grip's turn.
  view.dispatch(closeHistory(view.state.tr));
  return true;
}

// A pressed toggle reads as selected, as the composer's own Markdown toggle does.
const PRESSED = "aria-pressed:bg-kh-bg-selected aria-pressed:text-kh-text";
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const EMAIL = /^[^\s@/:#?]+@[^\s@/:]+\.[^\s@/:]+$/;
// `localhost:3000/x`, `example.com:8080`: a host and a port, not a scheme (`tel:123` has no dot).
const HOST_PORT = /^(?:localhost|[^\s/:@]+\.[^\s/:@]+):\d+(?:[/?#]|$)/i;

/**
 * `example.com` (and `example.com/a.md`) is a web address; a path, an anchor, anything with a scheme
 * (`mailto:`) or an explicitly relative link (`./other.md`, `../notes/other.md`) is left as typed. A
 * bare `notes/other.md` cannot be told from a host, so it is a web address when typed; an existing
 * link saved unedited keeps its address, and a document link edited to another document address
 * stays one (see `fieldHref`). `user@example.com` is mailed; `localhost:3000` is a host with a port.
 */
export function withScheme(value: string): string {
  if (!value || /^(?:\/|#|\?|\.\.?\/)/.test(value)) return value;
  if (EMAIL.test(value)) return `mailto:${value}`;
  if (HOST_PORT.test(value)) return `https://${value}`;
  if (HAS_SCHEME.test(value)) return value;
  return `https://${value}`;
}

type SelectedLink =
  | { kind: "none" }
  | { kind: "multiple" }
  | { kind: "one"; from: number; to: number; mark: Mark };

/** Some textblock the selection reaches may carry a link, as `toggleMark` asks (a code block may not). */
function linkAllowed(view: EditorView): boolean {
  const type = view.state.schema.marks.link;
  if (!type) return false;
  const { from, to } = view.state.selection;
  let allowed = false;
  view.state.doc.nodesBetween(from, to, (node) => {
    if (node.isTextblock && node.type.allowsMarkType(type)) allowed = true;
  });
  return allowed;
}

/** Find one complete link even when the selection covers only part of it. */
function selectedLink(view: EditorView): SelectedLink {
  const type = view.state.schema.marks.link;
  const { from, to, empty } = view.state.selection;
  if (!type || empty) return { kind: "none" };
  const runs: { from: number; to: number; mark: Mark }[] = [];
  view.state.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isInline) return;
    const mark = type.isInSet(node.marks);
    if (!mark) return;
    const last = runs.at(-1);
    if (last && last.to === pos && last.mark.eq(mark)) last.to = pos + node.nodeSize;
    else runs.push({ from: pos, to: pos + node.nodeSize, mark });
  });
  if (runs.length === 0) return { kind: "none" };
  if (runs.length > 1) return { kind: "multiple" };

  const run = runs[0];
  return expandRun(view, run.from, run.mark);
}

/** The whole run of text carrying `mark` that the text at `pos` belongs to (a link split by formatting is still one link). */
function expandRun(view: EditorView, pos: number, mark: Mark): SelectedLink {
  const type = view.state.schema.marks.link;
  const run = { from: pos, mark };
  const $start = view.state.doc.resolve(run.from);
  const parentStart = $start.start();
  const siblings: { from: number; to: number; matches: boolean }[] = [];
  $start.parent.forEach((node, offset) => {
    const mark = type.isInSet(node.marks);
    siblings.push({ from: parentStart + offset, to: parentStart + offset + node.nodeSize, matches: Boolean(mark?.eq(run.mark)) });
  });
  let first = siblings.findIndex((node) => node.from <= run.from && node.to > run.from);
  let last = first;
  if (first < 0) return { kind: "multiple" };
  while (first > 0 && siblings[first - 1].matches) first--;
  while (last + 1 < siblings.length && siblings[last + 1].matches) last++;
  return { kind: "one", from: siblings[first].from, to: siblings[last].to, mark: run.mark };
}

/** The link the caret is in (no selection range), or null. Wikilinks are nodes, not link marks, so never count. */
function caretLink(view: EditorView): Extract<SelectedLink, { kind: "one" }> | null {
  const type = view.state.schema.marks.link;
  const { selection } = view.state;
  if (!type || !(selection instanceof TextSelection) || !selection.empty) return null;
  const mark = type.isInSet(selection.$from.marks());
  if (!mark) return null;
  const { $from } = selection;
  const pos = $from.nodeBefore && type.isInSet($from.nodeBefore.marks) ? $from.pos - 1 : $from.pos;
  const run = expandRun(view, pos, mark);
  return run.kind === "one" ? run : null;
}

// A leading `/` opens only as a path of this site: `//host` and `/\host` are both another origin.
const OPENABLE = /^(?:https?:|mailto:|\/(?![/\\])|#)/i;

/**
 * Where a link already in the document opens, or null. Unlike typed input it is never given a
 * scheme: a relative `.md` link is a document, resolved as the reader resolves it (`markdown-base`),
 * and anything else opens only as written.
 */
export function storedLinkTarget(href: string, links?: RenderedLinks): string | null {
  const value = href.trim();
  const document = parseDocumentHref(value);
  if (document) {
    const resolved = links?.[linkLookupKey("PATH", document.target)];
    if (resolved?.status !== "RESOLVED") return null;
    return `${resolved.basePath}${document.fragment ? `#${encodeURIComponent(document.fragment)}` : ""}`;
  }
  return OPENABLE.test(value) ? value : null;
}

type Item = {
  label: string;
  text: string;
  className?: string;
  active: (view: EditorView) => boolean;
  disabled?: (view: EditorView) => boolean;
  run: (ctx: Ctx, view: EditorView, openLink: () => void) => void;
};

const items: Item[] = [
  { label: "Bold", text: "B", className: "font-bold", active: (view) => markActive(view, "strong"), run: (ctx) => ctx.get(commandsCtx).call(toggleStrongCommand.key) },
  { label: "Italic", text: "I", className: "italic", active: (view) => markActive(view, "emphasis"), run: (ctx) => ctx.get(commandsCtx).call(toggleEmphasisCommand.key) },
  { label: "Strikethrough", text: "S", className: "line-through", active: (view) => markActive(view, "strike_through"), run: (ctx) => ctx.get(commandsCtx).call(toggleStrikethroughCommand.key) },
  { label: "Inline code", text: "</>", className: "font-mono", active: (view) => markActive(view, "inlineCode"), run: (ctx) => ctx.get(commandsCtx).call(toggleInlineCodeCommand.key) },
  {
    label: "Link",
    text: "Link",
    active: (view) => markActive(view, "link"),
    disabled: (view) => selectedLink(view).kind === "multiple" || !linkAllowed(view),
    run: (_ctx, _view, openLink) => openLink(),
  },
  // Notion's clear-formatting habit: one press takes every inline mark off the selection, or the
  // mark the caret would type with. Cmd/Ctrl-\ runs the same action (the editor's shortcut).
  { label: "Clear formatting", text: "Tx", className: "text-caption", active: () => false, run: (_ctx, view) => { clearFormatting(view); } },
];

function clearFormatting(view: EditorView): boolean {
  if (!view.editable) return false;
  const { from, to, empty } = view.state.selection;
  const transaction = view.state.tr;
  // Formatting goes, the address stays: a link is content, and select-all then clear must not
  // silently drop every URL in the document.
  const kept = (mark: Mark) => mark.type.name === "link";
  if (empty) transaction.setStoredMarks((view.state.storedMarks ?? view.state.selection.$from.marks()).filter(kept));
  else for (const type of Object.values(view.state.schema.marks)) if (type.name !== "link") transaction.removeMark(from, to, type);
  view.dispatch(empty ? transaction : closeHistory(transaction));
  view.focus();
  return true;
}

const PASTED_URL = /^https?:\/\/\S+$/i;

/**
 * Pasting one web address over selected text links the text instead of replacing it (design
 * decision 12); at a caret it pastes as a link to itself. Only a plain-text paste of a single http(s)
 * URL, whitespace nowhere inside it, in text that may carry a link; everything else pastes as before.
 */
const pasteUrlOverSelection = $prose(
  () =>
    new Plugin({
      key: new PluginKey("khPasteUrlOverSelection"),
      props: {
        handlePaste(view, event) {
          const text = event.clipboardData?.getData("text/plain").trim() ?? "";
          const { selection, schema } = view.state;
          const type = schema.marks.link;
          if (!view.editable || !type || !PASTED_URL.test(text) || !(selection instanceof TextSelection)) return false;
          try { new URL(text); } catch { return false; }
          if (selection.empty) {
            // At a caret the address is pasted as a link to itself (2026-11-19 paste-and-links decision 2).
            const marks = view.state.storedMarks ?? selection.$from.marks();
            if (!selection.$from.parent.type.allowsMarkType(type) || marks.some((mark) => mark.type.spec.code === true || mark.type.name === "inlineCode")) return false;
            event.preventDefault();
            const kept = marks.filter((mark) => mark.type !== type);
            view.dispatch(view.state.tr.replaceSelectionWith(schema.text(text, [...kept, type.create({ href: text })]), false).setStoredMarks(kept).scrollIntoView());
            return true;
          }
          // As the Link button asks; `addMark` leaves a code block in the selection as it was.
          if (!linkAllowed(view)) return false;
          event.preventDefault();
          view.dispatch(view.state.tr.addMark(selection.from, selection.to, type.create({ href: text })).scrollIntoView());
          return true;
        },
      },
    }),
);

/**
 * The toolbar that floats over a text selection (composer spec §11.4). Built
 * from the DOM because it lives inside a ProseMirror plugin, not React.
 *
 * Every button is `type="button"`: the editor sits inside the composer's
 * `<form>`, where the default type submits — that is, saves. `mousedown` is
 * cancelled on them so pressing one does not take the selection with it.
 */
export function selectionToolbar(comment?: { available: () => boolean; run: (view: EditorView) => void }, links?: () => RenderedLinks | undefined): { plugins: MilkdownPlugin[]; configure: (ctx: Ctx) => void } {
  return {
    plugins: [tooltip, pasteUrlOverSelection].flat() as MilkdownPlugin[],
    configure: (ctx) => {
      ctx.set(tooltip.key, {
        view: (editorView) => {
          const element = document.createElement("div");
          element.className = "kh-selection-toolbar";
          element.setAttribute("role", "toolbar");
          element.setAttribute("aria-label", "Formatting");

          // One of the two rows is shown. Their whole class list is swapped rather than
          // toggling `hidden`, which a `flex` on the same element would override.
          const buttons = document.createElement("div");
          const linkRow = document.createElement("div");
          let linkMode = false;
          function setLinkMode(on: boolean) {
            linkMode = on;
            buttons.className = on ? "hidden" : "flex flex-wrap items-center gap-0.5";
            linkRow.className = on ? "flex flex-col gap-2" : "hidden";
          }
          setLinkMode(false);
          element.append(buttons, linkRow);

          // ---- Turn into (2026-11-21 list-commands spec, decisions 5-7) ------------------------------
          // First on the toolbar: the current kind and a chevron. Its menu is the grip menu's Turn into list, in the
          // block menu's own surface, under the button; it is part of the toolbar, so focus in it keeps the toolbar.
          const turnButton = document.createElement("button");
          turnButton.type = "button";
          turnButton.className = buttonClasses({ variant: "ghost", size: "sm", className: `${PRESSED} shrink-0` });
          turnButton.title = "Turn into";
          turnButton.setAttribute("aria-haspopup", "menu");
          turnButton.setAttribute("aria-expanded", "false");
          const turnText = document.createElement("span");
          const chevron = document.createElementNS("http://www.w3.org/2000/svg", "svg");
          for (const [name, value] of Object.entries({ viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", class: "size-3" })) chevron.setAttribute(name, value);
          const chevronPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
          chevronPath.setAttribute("d", "m6 9 6 6 6-6");
          chevron.append(chevronPath);
          turnButton.append(turnText, chevron);
          const turnSeparator = document.createElement("div");
          turnSeparator.setAttribute("role", "separator");
          turnSeparator.setAttribute("aria-orientation", "vertical");
          turnSeparator.className = "mx-0.5 h-4 w-px bg-kh-border";
          buttons.append(turnButton, turnSeparator);
          const turnMenu = document.createElement("div");
          turnMenu.className = "kh-block-move-menu";
          turnMenu.hidden = true;
          turnMenu.setAttribute("role", "menu");
          turnMenu.setAttribute("aria-label", "Turn into");
          element.append(turnMenu);
          function setTurnLabel(view: EditorView) {
            const label = turnLabel(blocksTouched(view.state));
            turnText.textContent = label;
            turnButton.setAttribute("aria-label", `Turn into, ${label}`);
          }
          function renderTurnMenu(view: EditorView) {
            const blocks = blocksTouched(view.state);
            turnMenu.replaceChildren(...TURN_OPTIONS.map(([kind, label]) => {
              const entry = document.createElement("button");
              entry.type = "button";
              entry.setAttribute("role", "menuitemradio");
              entry.textContent = label;
              const { checked, disabled } = turnEntry(blocks, kind);
              entry.setAttribute("aria-checked", String(checked));
              entry.disabled = disabled;
              entry.addEventListener("click", () => {
                if (entry.disabled) return;
                // Focus goes back first: a focused entry that is hidden would blur to nowhere, which hides the toolbar.
                editorView.focus();
                closeTurnMenu();
                turnSelection(editorView, kind);
              });
              return entry;
            }));
          }
          function closeTurnMenu() {
            turnMenu.hidden = true;
            turnButton.setAttribute("aria-expanded", "false");
          }
          function openTurnMenu() {
            renderTurnMenu(editorView);
            turnMenu.hidden = false;
            turnButton.setAttribute("aria-expanded", "true");
            void computePosition(turnButton, turnMenu, { strategy: "fixed", placement: "bottom-start", middleware: [offset(4), flip(), shift({ padding: 8 })] }).then(({ x, y }) => {
              Object.assign(turnMenu.style, { left: `${x}px`, top: `${y}px` });
            });
            turnMenu.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
          }
          turnButton.addEventListener("mousedown", (event) => event.preventDefault());
          turnButton.addEventListener("click", () => {
            if (!editorView.editable) return;
            if (turnMenu.hidden) openTurnMenu();
            else { editorView.focus(); closeTurnMenu(); }
          });
          // As the grip menu: arrows move among the enabled entries; Escape and Tab close it and go back to the text,
          // and stop here, so the composer's Escape does not leave the page.
          turnMenu.addEventListener("keydown", (event) => {
            if (event.isComposing || event.keyCode === 229) return;
            if (event.key === "Escape" || event.key === "Tab") {
              event.preventDefault();
              event.stopPropagation();
              editorView.focus();
              closeTurnMenu();
              return;
            }
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              event.stopPropagation();
              const enabled = [...turnMenu.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
              if (!enabled.length) return;
              const at = enabled.indexOf(document.activeElement as HTMLButtonElement);
              enabled[(at + (event.key === "ArrowDown" ? 1 : -1) + enabled.length) % enabled.length].focus();
            }
          });

          const pressers = items.map((item) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = buttonClasses({ variant: "ghost", size: "sm", className: `${PRESSED} ${item.className ?? ""}` });
            button.textContent = item.text;
            button.title = item.label;
            button.setAttribute("aria-label", item.label);
            button.addEventListener("mousedown", (event) => event.preventDefault());
            button.addEventListener("click", () => {
              if (!editorView.editable || button.disabled) return;
              item.run(ctx, editorView, openLink);
              if (!linkMode) editorView.focus();
            });
            buttons.appendChild(button);
            return { item, button };
          });

          const input = document.createElement("input");
          const commentGroup = document.createElement("div");
          commentGroup.className = "ml-1 border-l border-kh-border pl-1";
          commentGroup.setAttribute("data-review-comment-control", "");
          const commentButton = document.createElement("button");
          commentButton.type = "button";
          commentButton.className = buttonClasses({ variant: "ghost", size: "md" });
          const commentIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
          for (const [name, value] of Object.entries({ viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", class: "size-4 sm:hidden" })) commentIcon.setAttribute(name, value);
          // Message-square-plus, matching the application's Lucide comment icon.
          for (const d of ["M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z", "M12 8v6", "M9 11h6"]) {
            const path = document.createElementNS("http://www.w3.org/2000/svg", "path"); path.setAttribute("d", d); commentIcon.append(path);
          }
          const commentLabel = document.createElement("span");
          commentLabel.className = "hidden sm:inline"; commentLabel.textContent = "Comment";
          commentButton.append(commentIcon, commentLabel);
          commentButton.title = "Comment on selection";
          commentButton.setAttribute("aria-label", "Comment on selection");
          commentButton.addEventListener("mousedown", event => event.preventDefault());
          commentButton.addEventListener("click", () => {
            if (!comment?.available()) return;
            comment.run(editorView);
            provider.hide();
          });
          commentGroup.append(commentButton);
          commentGroup.hidden = !comment?.available();
          if (comment) buttons.append(commentGroup);
          // Not `type="url"`: inside the composer's validating form that would block Save on half-typed text.
          input.type = "text";
          input.setAttribute("inputmode", "url");
          input.setAttribute("autocomplete", "off");
          input.placeholder = "https://";
          input.setAttribute("aria-label", "Link address");
          input.className = fieldClasses({ size: "sm", className: "w-56" });
          const linkLabel = document.createElement("label");
          linkLabel.className = "flex flex-col gap-1 text-caption text-kh-text-muted";
          linkLabel.append("Link address", input);
          linkRow.appendChild(linkLabel);
          const linkActions = document.createElement("div");
          linkActions.className = "flex items-center gap-1";
          const openButton = document.createElement("button");
          const removeButton = document.createElement("button");
          const saveButton = document.createElement("button");
          for (const [button, label, text] of [
            [openButton, "Open link", "Open"],
            [removeButton, "Remove link", "Remove"],
            [saveButton, "Save link", "Save"],
          ] as const) {
            button.type = "button";
            button.setAttribute("aria-label", label);
            button.textContent = text;
            button.className = buttonClasses({ variant: button === saveButton ? "primary" : "ghost", size: "sm", className: button === saveButton ? "ml-auto" : "" });
            linkActions.appendChild(button);
          }
          linkRow.appendChild(linkActions);
          let editingLink: Extract<SelectedLink, { kind: "one" }> | null = null;
          // What the field's address opens: a web address as typed, a document as the reader resolves it.
          const fieldTarget = (value: string) => storedLinkTarget(fieldHref(value), links?.());
          const updateLinkActions = () => {
            openButton.disabled = !fieldTarget(input.value);
            removeButton.disabled = !editingLink;
            saveButton.disabled = !input.value.trim();
          };
          input.addEventListener("input", updateLinkActions);
          // Pressing the toolbar's padding must not take focus (and with it the toolbar) from the editor either.
          element.addEventListener("mousedown", (event) => {
            if (event.target !== input) event.preventDefault();
          });

          function showButtons() {
            setLinkMode(false);
            input.value = "";
            editingLink = null;
          }
          function openLink() {
            const target = selectedLink(editorView);
            if (target.kind === "multiple") return;
            editingLink = target.kind === "one" ? target : null;
            input.value = editingLink ? String(editingLink.mark.attrs.href ?? "") : "";
            updateLinkActions();
            setLinkMode(true);
            input.focus();
          }
          /**
           * The field's address as it would be saved: an existing link's own address, left unedited, stays as
           * written, and a document link edited to another document address (`other.md#sec`) stays a document link.
           */
          function fieldHref(value: string): string {
            const typed = value.trim();
            if (!editingLink) return withScheme(typed);
            const original = String(editingLink.mark.attrs.href ?? "").trim();
            if (typed === original || (parseDocumentHref(original) && parseDocumentHref(typed))) return typed;
            return withScheme(typed);
          }
          function saveLink() {
            const href = fieldHref(input.value);
            if (!href) {
              if (!editingLink) {
                showButtons();
                editorView.focus();
              }
              return;
            }
            const target = editingLink;
            if (target) {
              const current = selectedLink(editorView);
              if (current.kind !== "one" || current.from !== target.from || current.to !== target.to || !current.mark.eq(target.mark)) return;
              const type = editorView.state.schema.marks.link;
              editorView.dispatch(editorView.state.tr.removeMark(target.from, target.to, type).addMark(target.from, target.to, type.create({ ...target.mark.attrs, href })));
            } else {
              ctx.get(commandsCtx).call(toggleLinkCommand.key, { href });
            }
            showButtons();
            editorView.focus();
          }
          openButton.addEventListener("click", () => {
            const target = fieldTarget(input.value);
            if (target) window.open(target, "_blank", "noopener,noreferrer");
          });
          removeButton.addEventListener("click", () => {
            const target = editingLink;
            const current = selectedLink(editorView);
            if (!target || current.kind !== "one" || current.from !== target.from || current.to !== target.to || !current.mark.eq(target.mark)) return;
            editorView.dispatch(editorView.state.tr.removeMark(target.from, target.to, editorView.state.schema.marks.link));
            showButtons();
            editorView.focus();
          });
          saveButton.addEventListener("click", saveLink);
          // Enter and Esc stop here: a bare Enter would submit the composer's form, and Esc would leave
          // the page. Every other key still bubbles, so ⌘K reaches the global search.
          linkRow.addEventListener("keydown", (event) => {
            if (event.key !== "Enter" && event.key !== "Escape") return;
            event.stopPropagation();
            if (event.isComposing || event.keyCode === 229) return;
            if (event.key === "Escape") {
              event.preventDefault();
              showButtons();
              editorView.focus();
            } else if (event.key === "Enter" && event.target === input) {
              event.preventDefault();
              saveLink();
            }
          });

          // ---- The link card (decision 11) --------------------------------------------------------
          // A small card under the link the caret is in: its address, with Open, Edit and Remove. It
          // shows when the caret enters a link (by key or by a plain click), and hides when the caret
          // leaves, on Escape, or when the link scrolls out of view. One at a time; Edit is the
          // toolbar's own link field above, not a second editor.
          const card = document.createElement("div");
          card.className = "kh-link-card";
          card.dataset.show = "false";
          card.setAttribute("role", "group");
          card.setAttribute("aria-label", "Link");
          const cardAddress = document.createElement("span");
          cardAddress.className = "kh-link-card-address truncate px-2 text-caption text-kh-text-muted";
          card.appendChild(cardAddress);
          const copyStatus = document.createElement("span");
          copyStatus.className = "sr-only";
          copyStatus.setAttribute("aria-live", "polite");
          copyStatus.setAttribute("data-copy-status", "");
          const cardButtons = new Map<string, HTMLButtonElement>();
          for (const [label, text] of [["Copy link", "Copy"], ["Open link", "Open"], ["Edit link", "Edit"], ["Remove link", "Remove"]] as const) {
            const cardButton = document.createElement("button");
            cardButton.type = "button";
            cardButton.textContent = text;
            cardButton.setAttribute("aria-label", label);
            cardButton.className = buttonClasses({ variant: "ghost", size: "sm" });
            card.appendChild(cardButton);
            cardButtons.set(label, cardButton);
          }
          card.appendChild(copyStatus);
          // Pressing the card must not take the caret (and the link with it) out of the editor.
          card.addEventListener("mousedown", (event) => event.preventDefault());
          let cardLink: Extract<SelectedLink, { kind: "one" }> | null = null;
          let leftAt: Extract<SelectedLink, { kind: "one" }> | null = null;
          let pointerDown = false;
          let pointerTimer: ReturnType<typeof setTimeout> | undefined;
          const linkRect = (link: { from: number; to: number }) => posToDOMRect(editorView, link.from, link.to);
          const cardVirtual = (link: { from: number; to: number }) => ({ getBoundingClientRect: () => linkRect(link), contextElement: editorView.dom });
          function placeCard(link: { from: number; to: number }) {
            void computePosition(cardVirtual(link), card, { placement: "bottom-start", middleware: [flip(() => ({ boundary: boundary() })), offset(6), shift()] }).then(({ x, y }) => {
              Object.assign(card.style, { left: `${x}px`, top: `${y}px` });
            });
          }
          function hideCard() {
            cardLink = null;
            if (card.dataset.show !== "false") card.dataset.show = "false";
          }
          let copyTimer: ReturnType<typeof setTimeout> | undefined;
          function showCard(link: Extract<SelectedLink, { kind: "one" }>) {
            const href = String(link.mark.attrs.href ?? "");
            cardLink = link;
            cardAddress.textContent = href;
            cardAddress.title = href;
            clearTimeout(copyTimer);
            copyStatus.textContent = "";
            cardButtons.get("Copy link")!.textContent = "Copy";
            cardButtons.get("Copy link")!.setAttribute("aria-label", "Copy link");
            cardButtons.get("Open link")!.disabled = !storedLinkTarget(href, links?.());
            if (!card.isConnected) (editorView.dom.parentElement ?? document.body).appendChild(card);
            card.dataset.show = "true";
            placeCard(link);
          }
          function isCardLink(link: Extract<SelectedLink, { kind: "one" }>) {
            return cardLink !== null && cardLink.from === link.from && cardLink.to === link.to && cardLink.mark.eq(link.mark);
          }
          function syncCard(view: EditorView, prevSelectionChanged: boolean) {
            const link = view.editable && (view.hasFocus() || card.contains(document.activeElement)) && !linkMode ? caretLink(view) : null;
            if (!link) {
              if (cardLink || leftAt) leftAt = null;
              hideCard();
              return;
            }
            if (isCardLink(link)) { cardLink = link; placeCard(link); return; }
            // Typing inside a shown link changes its range and address: follow it rather than keep the old one.
            if (cardLink && card.dataset.show === "true" && !prevSelectionChanged) { showCard(link); return; }
            // Not yet showing for this link: it shows on entering it, or on a click, and not again
            // after Escape until the caret has been out of it (or a click lands in it).
            const dismissed = leftAt !== null && leftAt.from === link.from && leftAt.to === link.to && leftAt.mark.eq(link.mark);
            if (!prevSelectionChanged) return;
            if (dismissed && !pointerDown) return;
            leftAt = null;
            showCard(link);
          }
          function dismissCard() {
            if (cardLink) leftAt = cardLink;
            hideCard();
          }
          editorView.dom.addEventListener("mousedown", (event) => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            pointerDown = true;
            clearTimeout(pointerTimer);
            pointerTimer = setTimeout(() => { pointerDown = false; }, 600);
          });
          cardButtons.get("Copy link")!.addEventListener("click", () => {
            const href = String(cardLink?.mark.attrs.href ?? "");
            if (!href || !navigator.clipboard) return;
            const copied = href;
            // A repeated "Link copied" is not a new mutation; clear first so the next one announces.
            copyStatus.textContent = "";
            clearTimeout(copyTimer);
            void navigator.clipboard.writeText(href).then(() => {
              if (String(cardLink?.mark.attrs.href ?? "") !== copied) return;
              const button = cardButtons.get("Copy link")!;
              // The visible word and the accessible name change together (Label in Name), and the
              // status announces the copy to a screen reader.
              button.textContent = "Copied";
              button.setAttribute("aria-label", "Copied");
              copyStatus.textContent = "Link copied";
              clearTimeout(copyTimer);
              copyTimer = setTimeout(() => {
                button.textContent = "Copy";
                button.setAttribute("aria-label", "Copy link");
                copyStatus.textContent = "";
              }, 1500);
            }, () => { /* a refused clipboard leaves the card as it was */ });
          });
          cardButtons.get("Open link")!.addEventListener("click", () => {
            const target = storedLinkTarget(String(cardLink?.mark.attrs.href ?? ""), links?.());
            if (target) window.open(target, "_blank", "noopener,noreferrer");
          });
          cardButtons.get("Edit link")!.addEventListener("click", () => {
            const target = cardLink;
            if (!target) return;
            hideCard();
            editorView.dispatch(editorView.state.tr.setSelection(TextSelection.create(editorView.state.doc, target.from, target.to)));
            provider.show(cardVirtual(target), editorView);
            openLink();
          });
          cardButtons.get("Remove link")!.addEventListener("click", () => {
            const target = caretLink(editorView) ?? cardLink;
            if (!target || !editorView.editable) return;
            hideCard();
            editorView.dispatch(editorView.state.tr.removeMark(target.from, target.to, editorView.state.schema.marks.link));
            editorView.focus();
          });
          // Escape closes the card before anything else gets it: in capture, on the editor, ahead of the
          // keymap that would select the block (and the composer's Esc that would leave the page).
          function closeCardOnEscape(event: KeyboardEvent) {
            if (event.key !== "Escape" || card.dataset.show !== "true" || event.isComposing || event.keyCode === 229) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            dismissCard();
            editorView.focus();
          }
          editorView.dom.addEventListener("keydown", closeCardOnEscape, true);
          card.addEventListener("keydown", (event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            dismissCard();
            editorView.focus();
          });
          card.addEventListener("focusout", (event) => {
            const next = event.relatedTarget;
            if (next === null && !document.hasFocus()) return;
            if (next instanceof Node && (card.contains(next) || editorView.dom.contains(next))) return;
            hideCard();
          });
          const hideCardOnBlur = (event: FocusEvent) => {
            if (event.relatedTarget instanceof Node && card.contains(event.relatedTarget)) return;
            if (event.relatedTarget === null && !document.hasFocus()) return;
            hideCard();
          };
          editorView.dom.addEventListener("blur", hideCardOnBlur);
          // Scrolling moves the link under the card: follow it, and let go when it has left the editor's view.
          const onScroll = () => {
            const link = cardLink;
            if (!link) return;
            const rect = linkRect(link);
            const bounds = [editorView.dom, ...getOverflowAncestors(editorView.dom).filter((node): node is Element => node instanceof Element)].map((node) => node.getBoundingClientRect());
            const outside = rect.bottom < 0 || rect.top > window.innerHeight || bounds.some((box) => box.height > 0 && (rect.bottom < box.top || rect.top > box.bottom));
            if (outside) dismissCard();
            else placeCard(link);
          };
          window.addEventListener("scroll", onScroll, true);

          // ⌘/Ctrl-K over a text selection is the link field, not the palette: the editor handles the event
          // (`preventDefault`), and the palette's listener yields to a handled event. With no selection it
          // is left alone, and reaches the palette.
          function openLinkOnModK(event: KeyboardEvent) {
            if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== "k") return;
            if (event.isComposing || event.keyCode === 229) return;
            const { selection } = editorView.state;
            if (!editorView.editable || !(selection instanceof TextSelection) || selection.empty || selectedLink(editorView).kind === "multiple" || !linkAllowed(editorView)) return;
            event.preventDefault();
            hideCard();
            if (element.dataset.show !== "true") provider.show({ getBoundingClientRect: () => posToDOMRect(editorView, selection.from, selection.to), contextElement: editorView.dom }, editorView);
            openLink();
          }
          editorView.dom.addEventListener("keydown", openLinkOnModK);
          // The same action as the toolbar's Clear formatting. Shift is required: Cmd/Ctrl-\ is the
          // app's navigation toggle, and the editor must not take it (keyboard-shortcuts spec §10).
          function clearOnModShiftBackslash(event: KeyboardEvent) {
            // Shift+Backslash is "|" on a US keyboard; match the physical key. `key` is the fallback
            // only where the environment reports no code, so a JIS Shift+¥ is not this shortcut.
            if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.altKey) return;
            if (event.code ? event.code !== "Backslash" : event.key !== "\\" && event.key !== "|") return;
            if (event.isComposing || event.keyCode === 229) return;
            if (!clearFormatting(editorView)) return;
            event.preventDefault();
          }
          editorView.dom.addEventListener("keydown", clearOnModShiftBackslash);

          // Above the first line is the document's header ("Updated …"), not free space: flip below a
          // selection with no room above it inside the editor, as well as inside the panes that clip it
          // (Milkdown's default). Derived per placement, since the editor is mounted only after this runs.
          // The list replaces Milkdown's, so it keeps its offset and shift.
          const boundary = () => [editorView.dom, ...getOverflowAncestors(editorView.dom).filter((node): node is Element => node instanceof Element)];
          const provider = new TooltipProvider({
            content: element,
            // Milkdown's own rule, and none over a whole block chosen with Escape: Notion shows no toolbar there.
            shouldShow: (view) => {
              const { selection, doc } = view.state;
              if (!view.editable || selection.empty || (selection instanceof NodeSelection && selection.node.isBlock)) return false;
              if (selection instanceof TextSelection && !doc.textBetween(selection.from, selection.to).length) return false;
              return view.hasFocus() || element.contains(document.activeElement);
            },
            floatingUIOptions: { middleware: [flip(() => ({ boundary: boundary() })), offset(8), shift()] },
          });
          provider.onHide = () => { closeTurnMenu(); showButtons(); };
          // The provider re-evaluates only on ProseMirror updates, and neither a blur nor a focus
          // dispatches one. Focus moving into the toolbar itself (the link box) keeps it; focus
          // coming back (from the Markdown view, the title field) re-evaluates, so an unchanged
          // selection gets its toolbar back.
          function hideOnBlur(event: FocusEvent) {
            if (event.relatedTarget instanceof Node && element.contains(event.relatedTarget)) return;
            provider.hide();
          }
          // The link box, from its side: leaving it for the page closes it; going back into the
          // editor (Enter, Esc) or elsewhere in the toolbar does not. Switching browser tabs or
          // windows also blurs with a null relatedTarget — but the whole document lost focus with
          // it, so the half-typed address stays for the trip back.
          function hideOnLinkBoxBlur(event: FocusEvent) {
            const next = event.relatedTarget;
            if (next instanceof Node && (element.contains(next) || editorView.dom.contains(next))) return;
            if (next === null && !document.hasFocus()) return;
            provider.hide();
          }
          // Tab can move focus before the browser delivers selectionchange for the
          // last Shift+Arrow key. Capture that final range before leaving the editor.
          const captureSelectionOnTab = (event: KeyboardEvent) => {
            if (event.key !== "Tab") return;
            const selection = editorView.dom.ownerDocument.getSelection();
            if (!selection?.anchorNode || !selection.focusNode || !editorView.dom.contains(selection.anchorNode) || !editorView.dom.contains(selection.focusNode)) return;
            const anchor = editorView.posAtDOM(selection.anchorNode, selection.anchorOffset);
            const head = editorView.posAtDOM(selection.focusNode, selection.focusOffset);
            if (editorView.state.doc.resolve(anchor).parent.inlineContent && editorView.state.doc.resolve(head).parent.inlineContent) {
              editorView.dispatch(editorView.state.tr.setSelection(TextSelection.create(editorView.state.doc, anchor, head)));
            }
          };
          editorView.dom.addEventListener("keydown", captureSelectionOnTab, true);
          const showOnFocus = () => provider.update(editorView);
          editorView.dom.addEventListener("blur", hideOnBlur);
          editorView.dom.addEventListener("focus", showOnFocus);
          linkRow.addEventListener("focusout", hideOnLinkBoxBlur);
          turnMenu.addEventListener("focusout", hideOnLinkBoxBlur);

          return {
            update: (view, prevState) => {
              syncCard(view, !prevState || (prevState.doc.eq(view.state.doc) && !prevState.selection.eq(view.state.selection)));
              commentGroup.hidden = !comment?.available();
              setTurnLabel(view);
              turnButton.disabled = !view.editable;
              // The menu is for the blocks it opened over: another selection, or another document, closes it.
              if (!turnMenu.hidden && prevState && (!prevState.doc.eq(view.state.doc) || !prevState.selection.eq(view.state.selection))) closeTurnMenu();
              for (const { item, button } of pressers) {
                button.setAttribute("aria-pressed", String(item.active(view)));
                button.disabled = item.disabled?.(view) ?? false;
              }
              // A metadata-only update may replace a selection update inside the
              // provider's throttle window. Re-evaluate the live selection instead
              // of letting its same-state shortcut discard that pending reveal.
              provider.update(view);
            },
            destroy: () => {
              editorView.dom.removeEventListener("keydown", captureSelectionOnTab, true);
              editorView.dom.removeEventListener("blur", hideOnBlur);
              editorView.dom.removeEventListener("focus", showOnFocus);
              editorView.dom.removeEventListener("keydown", closeCardOnEscape, true);
              editorView.dom.removeEventListener("keydown", openLinkOnModK);
              editorView.dom.removeEventListener("keydown", clearOnModShiftBackslash);
              editorView.dom.removeEventListener("blur", hideCardOnBlur);
              window.removeEventListener("scroll", onScroll, true);
              clearTimeout(pointerTimer);
              clearTimeout(copyTimer);
              card.remove();
              provider.destroy();
              element.remove();
            },
          };
        },
      });
    },
  };
}

import { computePosition, flip, getOverflowAncestors, offset, shift } from "@floating-ui/dom";
import { commandsCtx } from "@milkdown/kit/core";
import type { Ctx, MilkdownPlugin } from "@milkdown/kit/ctx";
import { TooltipProvider, tooltipFactory } from "@milkdown/kit/plugin/tooltip";
import {
  liftListItemCommand,
  toggleInlineCodeCommand,
  toggleEmphasisCommand,
  toggleLinkCommand,
  toggleStrongCommand,
  turnIntoTextCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInOrderedListCommand,
} from "@milkdown/kit/preset/commonmark";
import { toggleStrikethroughCommand } from "@milkdown/kit/preset/gfm";
import { posToDOMRect } from "@milkdown/kit/prose";
import { Plugin, PluginKey, TextSelection } from "@milkdown/kit/prose/state";
import { $prose } from "@milkdown/kit/utils";
import type { Mark } from "@milkdown/kit/prose/model";
import type { EditorView } from "@milkdown/kit/prose/view";
import { buttonClasses } from "@/components/ui/button";
import { fieldClasses } from "@/components/ui/field";
import { convertBlockToDetails, inDetails } from "./details-toggle";

const tooltip = tooltipFactory("khSelectionToolbar");

function markActive(view: EditorView, name: string): boolean {
  const type = view.state.schema.marks[name];
  if (!type) return false;
  const { from, to, empty, $from } = view.state.selection;
  return empty ? Boolean(type.isInSet(view.state.storedMarks ?? $from.marks())) : view.state.doc.rangeHasMark(from, to, type);
}

function headingLevel(view: EditorView): number {
  const { parent } = view.state.selection.$from;
  return parent.type.name === "heading" ? Number(parent.attrs.level) : 0;
}

type ListName = "bullet_list" | "ordered_list";

/** The list the caret is directly in (the innermost one), if any. */
function currentList(view: EditorView): ListName | null {
  const { $from } = view.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const name = $from.node(depth).type.name;
    if (name === "bullet_list" || name === "ordered_list") return name;
  }
  return null;
}

// A pressed toggle reads as selected, as the composer's own Markdown toggle does.
const PRESSED = "aria-pressed:bg-kh-bg-selected aria-pressed:text-kh-text";
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** `example.com` is a web address; a path, an anchor or anything with a scheme (`mailto:`) is left as typed. */
export function withScheme(value: string): string {
  if (!value || HAS_SCHEME.test(value) || value.startsWith("/") || value.startsWith("#")) return value;
  return `https://${value}`;
}

type SelectedLink =
  | { kind: "none" }
  | { kind: "multiple" }
  | { kind: "one"; from: number; to: number; mark: Mark };

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

export function canOpenLink(value: string): boolean {
  return /^(?:https?:|mailto:|\/(?!\/)|#)/i.test(withScheme(value.trim()));
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
    disabled: (view) => selectedLink(view).kind === "multiple",
    run: (_ctx, _view, openLink) => openLink(),
  },
  ...[1, 2, 3].map<Item>((level) => ({
    label: `Heading ${level}`,
    text: `H${level}`,
    active: (view) => headingLevel(view) === level,
    run: (ctx, view) => {
      const commands = ctx.get(commandsCtx);
      if (headingLevel(view) === level) commands.call(turnIntoTextCommand.key);
      else commands.call(wrapInHeadingCommand.key, level);
    },
  })),
  // Inside a list, the other type's button is disabled: on an item's first paragraph, wrapping
  // would put a list first in the item, which the schema refuses. (A later paragraph of an item
  // could take a nested list; typing `- ` still does that.)
  {
    label: "Bulleted list",
    text: "•",
    active: (view) => currentList(view) === "bullet_list",
    disabled: (view) => currentList(view) === "ordered_list",
    run: (ctx, view) => ctx.get(commandsCtx).call(currentList(view) === "bullet_list" ? liftListItemCommand.key : wrapInBulletListCommand.key),
  },
  {
    label: "Numbered list",
    text: "1.",
    active: (view) => currentList(view) === "ordered_list",
    disabled: (view) => currentList(view) === "bullet_list",
    run: (ctx, view) => ctx.get(commandsCtx).call(currentList(view) === "ordered_list" ? liftListItemCommand.key : wrapInOrderedListCommand.key),
  },
  {
    label: "Toggle section",
    text: "Toggle",
    active: (view) => inDetails(view),
    disabled: (view) => {
      const parent = view.state.selection.$from.parent;
      return parent.type.name !== "paragraph" && parent.type.name !== "heading";
    },
    run: (ctx, view) => {
      convertBlockToDetails(view);
    },
  },
];

const PASTED_URL = /^https?:\/\/\S+$/i;

/**
 * Pasting one web address over selected text links the text instead of replacing it (design
 * decision 12). Only a plain-text paste of a single http(s) URL, whitespace nowhere inside it, and
 * only over a non-empty text selection in text that may carry a link; everything else pastes as before.
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
          if (!view.editable || !type || !PASTED_URL.test(text) || !(selection instanceof TextSelection) || selection.empty) return false;
          try { new URL(text); } catch { return false; }
          let allowed = true;
          view.state.doc.nodesBetween(selection.from, selection.to, (node) => {
            if (node.isTextblock && !node.type.allowsMarkType(type)) allowed = false;
          });
          if (!allowed) return false;
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
export function selectionToolbar(comment?: { available: () => boolean; run: (view: EditorView) => void }): { plugins: MilkdownPlugin[]; configure: (ctx: Ctx) => void } {
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
          const updateLinkActions = () => {
            openButton.disabled = !canOpenLink(input.value);
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
          function saveLink() {
            const href = withScheme(input.value.trim());
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
            const href = withScheme(input.value.trim());
            if (canOpenLink(href)) window.open(href, "_blank", "noopener,noreferrer");
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
          const cardButtons = new Map<string, HTMLButtonElement>();
          for (const [label, text] of [["Open link", "Open"], ["Edit link", "Edit"], ["Remove link", "Remove"]] as const) {
            const cardButton = document.createElement("button");
            cardButton.type = "button";
            cardButton.textContent = text;
            cardButton.setAttribute("aria-label", label);
            cardButton.className = buttonClasses({ variant: "ghost", size: "sm" });
            card.appendChild(cardButton);
            cardButtons.set(label, cardButton);
          }
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
          function showCard(link: Extract<SelectedLink, { kind: "one" }>) {
            const href = String(link.mark.attrs.href ?? "");
            cardLink = link;
            cardAddress.textContent = href;
            cardAddress.title = href;
            cardButtons.get("Open link")!.disabled = !canOpenLink(href);
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
          cardButtons.get("Open link")!.addEventListener("click", () => {
            const href = withScheme(String(cardLink?.mark.attrs.href ?? "").trim());
            if (canOpenLink(href)) window.open(href, "_blank", "noopener,noreferrer");
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
            if (!editorView.editable || !(selection instanceof TextSelection) || selection.empty || selectedLink(editorView).kind === "multiple") return;
            event.preventDefault();
            hideCard();
            if (element.dataset.show !== "true") provider.show({ getBoundingClientRect: () => posToDOMRect(editorView, selection.from, selection.to), contextElement: editorView.dom }, editorView);
            openLink();
          }
          editorView.dom.addEventListener("keydown", openLinkOnModK);

          // Above the first line is the document's header ("Updated …"), not free space: flip below a
          // selection with no room above it inside the editor, as well as inside the panes that clip it
          // (Milkdown's default). Derived per placement, since the editor is mounted only after this runs.
          // The list replaces Milkdown's, so it keeps its offset and shift.
          const boundary = () => [editorView.dom, ...getOverflowAncestors(editorView.dom).filter((node): node is Element => node instanceof Element)];
          const provider = new TooltipProvider({
            content: element,
            floatingUIOptions: { middleware: [flip(() => ({ boundary: boundary() })), offset(8), shift()] },
          });
          provider.onHide = showButtons;
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

          return {
            update: (view, prevState) => {
              syncCard(view, !prevState || (prevState.doc.eq(view.state.doc) && !prevState.selection.eq(view.state.selection)));
              commentGroup.hidden = !comment?.available();
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
              editorView.dom.removeEventListener("blur", hideCardOnBlur);
              window.removeEventListener("scroll", onScroll, true);
              clearTimeout(pointerTimer);
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

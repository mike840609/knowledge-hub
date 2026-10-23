import { projectReviewBlocks } from "@/modules/knowledge/domain/review-anchor";
import { htmlAsText } from "@/shared/markdown/remark-known-html";
import { REVIEW_PATH, reviewPathKey } from "@/shared/markdown/remark-review-paths";

/** Whether anything follows `node` in its block besides a run of hard breaks. The Markdown
 * serialiser drops a break that ends a block, so such a break contributes no space. */
function hasContentAfter(node: Node, root: HTMLElement): boolean {
  for (let current: Node | null = node; current && current !== root; current = current.parentNode) {
    for (let next = current.nextSibling; next; next = next.nextSibling) {
      if (next.nodeType === Node.TEXT_NODE) {
        if ((next as Text).data !== "") return true;
      } else if (next instanceof HTMLElement && next.matches('br[data-type="hardbreak"]')) {
        continue;
      } else if (next instanceof HTMLElement && (next.tagName === "IMG" || (next.textContent ?? "") !== "")) {
        return true;
      }
    }
  }
  return false;
}

/** Stamp the editor leaves the reader can prove, one block at a time. A block the editor
 * renders differently — an HTML block, a changed sentence — leaves its own element unstamped
 * instead of clearing the whole document. A signature shared by two blocks is never stamped:
 * duplicate paragraphs cannot steal each other's path, and the reader re-proves any path
 * by whole-text match before it anchors a comment. */
export function stampEditorReviewPaths(root: HTMLElement, markdown: string): boolean {
  root.querySelectorAll(`[${REVIEW_PATH}]`).forEach(element => element.removeAttribute(REVIEW_PATH));
  const blocks = projectReviewBlocks(markdown).filter(block => ["heading", "paragraph", "tableCell", "code"].includes(block.kind));
  const elements = Array.from(root.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6,p,td,th,pre"))
    .filter(element => !element.closest('[aria-hidden="true"],[hidden],[data-diagram-reason]') && !element.parentElement?.closest("pre,td,th"));
  const kind = (element: HTMLElement) => /^H[1-6]$/.test(element.tagName) ? "heading" : element.tagName === "P" ? "paragraph" : element.tagName === "PRE" ? "code" : "tableCell";
  const text = (element: HTMLElement, code: boolean) => {
    const copy = element.cloneNode(true) as HTMLElement;
    copy.querySelectorAll('.sr-only,[aria-hidden="true"],.ProseMirror-trailingBreak,.ProseMirror-separator').forEach(extra => extra.remove());
    // A hard break reads as the one space the page draws only when something follows it in the
    // block. One that ends the block is dropped by the Markdown serialiser, so it is no space; a
    // run of them is dropped together. Without this the fast path fails and duplicate blocks
    // elsewhere in the document lose their stamps.
    copy.querySelectorAll('br[data-type="hardbreak"]').forEach(br => {
      if (hasContentAfter(br, copy)) br.replaceWith(" ");
    });
    // The editor draws a footnote reference as its label and inline HTML as its raw source; the
    // projection reads them as nothing and `htmlAsText`. The stamp is identity, not permission.
    copy.querySelectorAll('sup[data-type="footnote_reference"]').forEach(extra => extra.remove());
    copy.querySelectorAll<HTMLElement>('span[data-type="html"]').forEach(html => html.replaceWith(htmlAsText(html.dataset.value ?? "")));
    const value = copy.textContent ?? "";
    return code ? value.replace(/\n$/, "") : value.replace(/[\t\n\r ]+/g, " ").replace(/^ /, "");
  };
  const expected = (index: number) => blocks[index].text.slice(blocks[index].hidden);
  if (blocks.length === elements.length && blocks.every((block, index) => kind(elements[index]) === block.kind && (!block.selectable || text(elements[index], block.kind === "code") === expected(index)))) {
    blocks.forEach((block, index) => {
      if (text(elements[index], block.kind === "code") === expected(index)) elements[index].setAttribute(REVIEW_PATH, reviewPathKey(block.path));
    });
    return true;
  }
  const signature = blocks.map((block, index) => `${block.kind}\0${expected(index)}`);
  const blockCount = new Map<string, number>();
  for (const item of signature) blockCount.set(item, (blockCount.get(item) ?? 0) + 1);
  const elementCount = new Map<string, number>();
  const elementSignature = elements.map(element => `${kind(element)}\0${text(element, element.tagName === "PRE")}`);
  for (const item of elementSignature) elementCount.set(item, (elementCount.get(item) ?? 0) + 1);
  const pending = new Map<string, number[]>();
  signature.forEach((item, index) => pending.set(item, [...(pending.get(item) ?? []), index]));
  let stamped = 0;
  elementSignature.forEach((item, index) => {
    const match = pending.get(item)?.shift();
    if (match === undefined || blockCount.get(item) !== 1 || elementCount.get(item) !== 1) return;
    elements[index].setAttribute(REVIEW_PATH, reviewPathKey(blocks[match].path));
    stamped += 1;
  });
  return stamped > 0;
}

import { Plugin, PluginKey, TextSelection, type Transaction } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet, type EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";

const reviewPathsKey = new PluginKey<DecorationSet>("kh-review-paths");
/** ProseMirror owns these attributes, so its DOM observer cannot discard them as
 * an external edit or replace the selected paragraph while overlays resolve it. */
export const createEditorReviewPathsPlugin = () => new Plugin<DecorationSet>({
  key: reviewPathsKey,
  state: {
    init: () => DecorationSet.empty,
    apply: (transaction, previous) => transaction.getMeta(reviewPathsKey) ?? (transaction.docChanged ? DecorationSet.empty : previous),
  },
  props: { decorations: state => reviewPathsKey.getState(state) },
  view(view) {
    const focusPassage = (event: Event) => {
      const request = event as CustomEvent<Range>;
      const range = request.detail;
      if (!view.dom.contains(range.startContainer) || range.startContainer.parentElement?.closest("[data-inline-code-preview]")) return;
      const from = view.posAtDOM(range.startContainer, range.startOffset);
      const to = view.posAtDOM(range.endContainer, range.endOffset);
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));
      view.focus();
      request.preventDefault();
    };
    const selectBlock = (event: Event) => {
      const request = event as CustomEvent<{ element: HTMLElement; selected: boolean }>;
      const { element, selected } = request.detail;
      if (!view.dom.contains(element) || element.closest("[data-inline-code-preview]")) return;
      const resolved = view.state.doc.resolve(view.posAtDOM(element, 0));
      for (let depth = resolved.depth; depth > 0; depth--) {
        const from = resolved.before(depth);
        if (view.nodeDOM(from) !== element) continue;
        const to = from + resolved.node(depth).nodeSize;
        let decorations = reviewPathsKey.getState(view.state) ?? DecorationSet.empty;
        const previous = decorations.find(from, to, spec => spec.reviewBlockSelected === true).filter(item => item.from === from && item.to === to);
        decorations = decorations.remove(previous);
        if (selected) decorations = decorations.add(view.state.doc, [Decoration.node(from, to, { class: "kh-comment-block-selected" }, { reviewBlockSelected: true })]);
        view.dispatch(view.state.tr.setMeta(reviewPathsKey, decorations));
        request.preventDefault();
        return;
      }
    };
    view.dom.addEventListener("kh:review-focus-range", focusPassage);
    view.dom.addEventListener("kh:review-block-selected", selectBlock);
    return { destroy: () => {
      view.dom.removeEventListener("kh:review-focus-range", focusPassage);
      view.dom.removeEventListener("kh:review-block-selected", selectBlock);
    } };
  },
});
export const editorReviewPathsPlugin = $prose(createEditorReviewPathsPlugin);

export function updateEditorReviewPaths(view: EditorView, markdown: string | undefined): boolean {
  view.dom.querySelectorAll(`[data-inline-code-preview] [${REVIEW_PATH}]`).forEach(element => element.removeAttribute(REVIEW_PATH));
  const copy = view.dom.cloneNode(true) as HTMLElement;
  const proven = markdown !== undefined && stampEditorReviewPaths(copy, markdown);
  const decorations: Decoration[] = [];
  if (proven) {
    const originals = Array.from(view.dom.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6,p,td,th,pre"));
    const copies = Array.from(copy.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6,p,td,th,pre"));
    copies.forEach((element, index) => {
      const path = element.getAttribute(REVIEW_PATH);
      if (path === null) return;
      const original = originals[index];
      if (original.closest("[data-inline-code-preview]")) {
        original.setAttribute(REVIEW_PATH, path);
        return;
      }
      const expected = /^H[1-6]$/.test(element.tagName) ? "heading" : element.tagName === "P" ? "paragraph" : element.tagName === "PRE" ? "code_block" : ["table_cell", "table_header"];
      const matches = (name: string) => Array.isArray(expected) ? expected.includes(name) : expected === name;
      const position = view.posAtDOM(original, 0);
      const resolved = view.state.doc.resolve(position);
      for (let depth = resolved.depth; depth > 0; depth--) {
        const node = resolved.node(depth);
        if (!matches(node.type.name)) continue;
        const start = resolved.before(depth);
        decorations.push(Decoration.node(start, start + node.nodeSize, { [REVIEW_PATH]: path }));
        return;
      }
      const node = resolved.nodeAfter;
      if (node && matches(node.type.name)) decorations.push(Decoration.node(position, position + node.nodeSize, { [REVIEW_PATH]: path }));
    });
  }
  if (proven) decorations.push(...(reviewPathsKey.getState(view.state)?.find(undefined, undefined, spec => spec.reviewBlockSelected === true) ?? []));
  const transaction = view.state.tr.setMeta(reviewPathsKey, DecorationSet.create(view.state.doc, decorations));
  view.dispatch(preserveEditorSelection(view, transaction));
  return !!proven;
}

/** UI availability updates must not replace a native selection still awaiting selectionchange. */
export function preserveEditorSelection(view: EditorView, transaction: Transaction): Transaction {
  // A native selection can arrive before ProseMirror receives selectionchange.
  // Updating decorations must not write its older caret back over that gesture.
  const selection = view.dom.ownerDocument.getSelection();
  const editableEndpoint = (node: Node | null) => node && view.dom.contains(node)
    && !(node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement)?.closest('[contenteditable="false"],[data-inline-code-preview]');
  if (view.hasFocus() && selection && editableEndpoint(selection.anchorNode) && editableEndpoint(selection.focusNode)) {
    try {
      const anchor = view.posAtDOM(selection.anchorNode!, selection.anchorOffset);
      const head = view.posAtDOM(selection.focusNode!, selection.focusOffset);
      if (view.state.doc.resolve(anchor).parent.inlineContent && view.state.doc.resolve(head).parent.inlineContent) {
        transaction.setSelection(TextSelection.create(view.state.doc, anchor, head));
      }
    } catch {
      // A concurrently replaced endpoint has no valid position in this document.
    }
  }
  return transaction;
}

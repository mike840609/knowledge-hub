import { projectReviewBlocks, type CanonicalReviewBlock } from "@/modules/knowledge/domain/review-anchor";
import { REVIEW_LIMITS, type ReviewAnchor } from "@/modules/knowledge/domain/document-review";
import { REVIEW_ITEM_PARAGRAPH, REVIEW_PATH, reviewPathKey } from "@/shared/markdown/remark-review-paths";

/**
 * The element each block of the Markdown is drawn as. The renderer says which on the element
 * itself (`remark-review-paths.ts`), so a block is found by where it is in the document and never
 * by counting the elements before it: what the reader draws differently somewhere else — a
 * callout's marker, a task's checkbox, the footnotes moved to the foot — is that block's matter.
 */
const LEAF = `[${REVIEW_PATH}],li[${REVIEW_ITEM_PARAGRAPH}]`;
const pathOf = (element: HTMLElement) => element.getAttribute(REVIEW_PATH) ?? element.getAttribute(REVIEW_ITEM_PARAGRAPH);
const leafOf = (node: Node) => (node.nodeType === Node.ELEMENT_NODE ? node as HTMLElement : node.parentElement)?.closest<HTMLElement>(LEAF) ?? null;
function leafElement(root: HTMLElement, key: string): HTMLElement | null {
  // A loose list draws the item's paragraph as a paragraph; a tight one as the item.
  return root.querySelector<HTMLElement>(`[${REVIEW_PATH}="${key}"]`) ?? root.querySelector<HTMLElement>(`li[${REVIEW_ITEM_PARAGRAPH}="${key}"]`);
}
// One document is asked about many times in a row (once per paragraph for its comment buttons), and
// projecting it parses all of it: the last answer is kept.
let projected: { markdown: string; blocks: Map<string, ReturnType<typeof projectReviewBlocks>[number]> } | null = null;
function blocksByPath(markdown: string) {
  if (projected?.markdown !== markdown) projected = { markdown, blocks: new Map(projectReviewBlocks(markdown).map(block => [reviewPathKey(block.path), block])) };
  return projected.blocks;
}

/**
 * What the page draws that is no part of a block's text: announcements, icons, an image's label, a
 * footnote's number — and in the editor, a footnote reference's label and an HTML comment's source
 * (spec §3c). `[role="img"]` cannot come from a document: the reader passes no HTML through, so it
 * is only the renderer's own label for a blocked image. The editor's selection proof reads no
 * space for an HTML `<br>` (raw source in a paragraph, a text-less hard break in a cell) or a
 * Markdown hard break (a text-less hard break wherever it is), so a break between words is
 * refused; one that only opens or ends a block leaves no text behind and is accepted.
 */
const NOT_TEXT = '.sr-only,[aria-hidden="true"],[role="img"],[data-footnote-ref],sup[data-type="footnote_reference"],span[data-type="html"][data-value^="<!--"][data-value$="-->"]';

/** Match the renderer's visible Markdown text: what `NOT_TEXT` names is left out. */
function readableText(node: HTMLElement | DocumentFragment): string {
  const copy = node.cloneNode(true) as HTMLElement | DocumentFragment;
  copy.querySelectorAll(NOT_TEXT).forEach(extra => extra.remove());
  return copy.textContent ?? "";
}
const WHITESPACE = /[\t\n\r ]/;
const flowed = (text: string) => text.replace(/[\t\n\r ]+/g, " ");
/** Text as the block's canonical text has it: code as written, anything else with its whitespace run together. */
const canonical = (block: CanonicalReviewBlock, text: string) => block.kind === "code" ? text : flowed(text);
/**
 * Text read from the start of a block's element, without the gap the page opens some blocks with —
 * a task's, after its box. No block's own text starts with a space, code aside.
 */
const fromStart = (block: CanonicalReviewBlock, text: string) => block.kind === "code" ? text : flowed(text).replace(/^ /, "");
/** The part of a block's text the page shows: all of it, but for a callout's marker. */
const shown = (block: CanonicalReviewBlock) => block.text.slice(block.hidden);
function leafText(element: HTMLElement, block: CanonicalReviewBlock): string {
  const copy = element.cloneNode(true) as HTMLElement;
  if (element.tagName === "LI") copy.querySelectorAll("ul,ol").forEach(list => list.remove());
  const text = readableText(copy);
  // The renderer ends a code block with a newline the code does not have.
  if (block.kind === "code") return text.replace(/\n$/, "");
  // ReactMarkdown emits structural newlines around nested tight lists; those
  // are not part of the parent paragraph's canonical text or selection offsets.
  return fromStart(block, element.tagName === "LI" ? text.replace(/[\t\n\r ]+$/, "") : text);
}

/**
 * Why a selection cannot take a comment. `none` is nothing to remark on — nothing selected, or
 * nothing of the document; the others are a selection of the document that a reader meant.
 */
export type ReviewSelectionProblem = "none" | "across" | "long" | "unsupported";
export type ReviewSelectionReading = { anchor: ReviewAnchor; problem?: undefined } | { anchor?: undefined; problem: ReviewSelectionProblem };

/** What a reader is told when what they selected cannot take a comment. */
/** Said beside Add comment while nothing is chosen, so the reader learns it before pressing it. */
export const COMMENT_HINT = "Select text in the document to comment on it.";
export const REVIEW_SELECTION_HINTS: Record<Exclude<ReviewSelectionProblem, "none">, string> = {
  across: "Select within one paragraph to comment.",
  long: `Select ${REVIEW_LIMITS.quote} characters or fewer to comment.`,
  unsupported: "This passage cannot take a comment.",
};

/**
 * A selection ending at the very start of what follows its block — a triple click selects a
 * paragraph that way — is a selection of that block: ended at the block's end.
 */
function withinLeaf(range: Range, element: HTMLElement): Range | null {
  if (element.contains(range.endContainer)) return range;
  const beyond = range.cloneRange();
  beyond.setStartAfter(element);
  if (beyond.toString().trim()) return null;
  const clamped = range.cloneRange();
  clamped.setEnd(element, element.childNodes.length);
  return clamped;
}

/** DOM mapping is proven by the whole text of the block the selection is in, never a quote-only search. */
export function readReviewSelection(root: HTMLElement, markdown: string, selection: Selection | null): ReviewSelectionReading {
  if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) return { problem: "none" };
  const chosen = selection.getRangeAt(0);
  return readReviewRange(root, markdown, chosen);
}

/** A captured range remains usable after focus moves to a comment control. */
export function readReviewRange(root: HTMLElement, markdown: string, chosen: Range): ReviewSelectionReading {
  if (chosen.collapsed) return { problem: "none" };
  if (!root.contains(chosen.startContainer) || !root.contains(chosen.endContainer) || !chosen.toString().trim()) return { problem: "none" };
  const element = leafOf(chosen.startContainer);
  if (!element) return { problem: leafOf(chosen.endContainer) ? "across" : "unsupported" };
  const range = withinLeaf(chosen, element);
  if (!range) return { problem: "across" };
  const block = blocksByPath(markdown).get(pathOf(element) ?? "");
  if (!block?.selectable || leafText(element, block) !== shown(block)) return { problem: "unsupported" };
  const before = range.cloneRange(); before.selectNodeContents(element); before.setEnd(range.startContainer, range.startOffset);
  const through = range.cloneRange(); through.selectNodeContents(element); through.setEnd(range.endContainer, range.endOffset);
  // Places are counted in the block's text, which a callout's marker is part of.
  const led = fromStart(block, readableText(before.cloneContents()));
  const startUtf16 = block.hidden + led.length;
  const reached = block.hidden + fromStart(block, readableText(through.cloneContents())).length;
  const endUtf16 = Math.min(reached, block.text.length);
  const exact = block.text.slice(startUtf16, endUtf16);
  const selected = led ? canonical(block, readableText(range.cloneContents())) : fromStart(block, readableText(range.cloneContents()));
  // Past the block's text there is only what the renderer put after it: a code block's last
  // newline, a tight item's nested list. The quote is what was selected up to there.
  if (!exact.trim() || (reached > block.text.length ? !selected.startsWith(exact) : selected !== exact)) return { problem: "unsupported" };
  if ([...exact].length > REVIEW_LIMITS.quote) return { problem: "long" };
  const context = REVIEW_LIMITS.context;
  return { anchor: { schemaVersion: 1, blockPath: block.path, blockKind: block.kind, startUtf16, endUtf16, exact, prefix: [...block.text.slice(0, startUtf16)].slice(-context).join(""), suffix: [...block.text.slice(endUtf16)].slice(0, context).join("") } };
}

export function selectedReviewAnchor(root: HTMLElement, markdown: string, selection: Selection | null): ReviewAnchor | null {
  return readReviewSelection(root, markdown, selection).anchor ?? null;
}

/** Build a proven DOM range from canonical offsets, including collapsed soft whitespace.
 * Tight list text excludes nested lists, matching the AST paragraph leaf. */
export function createReviewRangeResolver(root: HTMLElement, markdown: string) {
  const blocks = blocksByPath(markdown);
  return (anchor: ReviewAnchor): Range | null => {
  const key = reviewPathKey(anchor.blockPath);
  const block = blocks.get(key), element = leafElement(root, key);
  if (!element || !block?.selectable || leafText(element, block) !== shown(block) || anchor.startUtf16 < block.hidden || block.text.slice(anchor.startUtf16, anchor.endUtf16) !== anchor.exact) return null;
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const extra = node.parentElement?.closest(NOT_TEXT);
      if (extra && element.contains(extra)) return NodeFilter.FILTER_REJECT;
      if (element.tagName !== "LI") return NodeFilter.FILTER_ACCEPT;
      const list = node.parentElement?.closest("ul,ol");
      return list && element.contains(list) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    },
  });
  const chars: { node: Text; offset: number; value: string }[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    for (let offset = 0; offset < node.length; offset++) chars.push({ node, offset, value: node.data[offset] });
  }
  const collapses = block.kind !== "code";
  // The gap a block's element opens with is no part of its text.
  if (collapses) while (chars.length && WHITESPACE.test(chars[0].value)) chars.shift();
  const starts: {node: Text; offset: number}[] = [], ends: {node: Text; offset: number}[] = [];
  for (let i = 0; i < chars.length; i++) {
    const first = chars[i];
    starts.push({node:first.node, offset:first.offset});
    if (collapses && WHITESPACE.test(first.value)) while (i + 1 < chars.length && WHITESPACE.test(chars[i + 1].value)) i++;
    ends.push({node:chars[i].node,offset:chars[i].offset+1});
  }
  const begin = starts[anchor.startUtf16 - block.hidden], end = ends[anchor.endUtf16 - 1 - block.hidden];
  if (!begin || !end) return null;
  const range = document.createRange(); range.setStart(begin.node,begin.offset);range.setEnd(end.node,end.offset);
  return canonical(block, readableText(range.cloneContents())) === anchor.exact ? range : null;
  };
}

export function reviewAnchorRange(root: HTMLElement, markdown: string, anchor: ReviewAnchor): Range | null {
  return createReviewRangeResolver(root, markdown)(anchor);
}

/** Focus a current quote without inserting nodes into rendered Markdown. */
export function focusReviewAnchor(root: HTMLElement, markdown: string, anchor: ReviewAnchor) {
  const range = reviewAnchorRange(root,markdown,anchor);
  if (!range) return;
  const element = leafOf(range.startContainer);
  if (!element) return;
  // A quote in a closed disclosure has no box to scroll to: an author's `<details>`, or a diagram's source.
  for (let closed = element.closest("details"); closed; closed = closed.parentElement?.closest("details") ?? null) closed.open = true;
  const editor = element.closest<HTMLElement>('[contenteditable="true"]');
  const focus = new CustomEvent("kh:review-focus-range", { cancelable: true, detail: range });
  if (!editor || editor.dispatchEvent(focus)) {
    element.tabIndex = -1; element.focus({ preventScroll: true });
    const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
  }
  element.scrollIntoView({ behavior: "smooth", block: "center" });
}

/** The block button's passage, narrowed to what is selected when the selection is inside it.
 * A collapsed, cross-block or elsewhere selection is not this button's: the caller keeps the
 * block anchor then, so a comment is still about the paragraph whose button was pressed. */
export function selectionAnchorInBlock(root: HTMLElement, markdown: string, block: ReviewAnchor, selection: Selection | null): ReviewAnchor | null {
  if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) return null;
  const reading = readReviewRange(root, markdown, selection.getRangeAt(0));
  if (!reading.anchor || reading.anchor.blockKind !== block.blockKind || reviewPathKey(reading.anchor.blockPath) !== reviewPathKey(block.blockPath)) return null;
  return reading.anchor;
}

/** A block control uses the same canonical path and DOM proof as text selection.
 * Long paragraphs anchor their opening passage within the server's quote limit. */
export function reviewBlockAnchor(element: HTMLElement, markdown: string): ReviewAnchor | null {
  const block = blocksByPath(markdown).get(pathOf(element) ?? "");
  if (!block?.selectable || leafText(element, block) !== shown(block)) return null;
  const exact = [...shown(block)].slice(0, REVIEW_LIMITS.quote).join("");
  if (!exact.trim()) return null;
  const startUtf16 = block.hidden;
  const endUtf16 = startUtf16 + exact.length;
  return { schemaVersion: 1, blockPath: block.path, blockKind: block.kind,
    startUtf16, endUtf16, exact,
    prefix: [...block.text.slice(0, startUtf16)].slice(-REVIEW_LIMITS.context).join(""),
    suffix: [...block.text.slice(endUtf16)].slice(0, REVIEW_LIMITS.context).join("") };
}

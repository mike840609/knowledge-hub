import { projectReviewBlocks } from "@/modules/knowledge/domain/review-anchor";
import type { ReviewAnchor } from "@/modules/knowledge/domain/document-review";

function leafElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>("p,h1,h2,h3,h4,h5,h6,li")).filter(element => element.tagName !== "LI" || !Array.from(element.children).some(child => child.tagName === "P"));
}
/** Match the renderer's visible Markdown text, not generated link announcements/icons. */
function readableText(node: HTMLElement | DocumentFragment): string {
  const copy = node.cloneNode(true) as HTMLElement | DocumentFragment;
  copy.querySelectorAll('.sr-only,[aria-hidden="true"]').forEach(extra => extra.remove());
  return copy.textContent ?? "";
}
function leafText(element: HTMLElement): string {
  const copy = element.cloneNode(true) as HTMLElement;
  if (element.tagName === "LI") copy.querySelectorAll("ul,ol").forEach(list => list.remove());
  const text = readableText(copy);
  // ReactMarkdown emits structural newlines around nested tight lists; those
  // are not part of the parent paragraph's canonical text or selection offsets.
  return element.tagName === "LI" ? text.replace(/[\t\n\r ]+$/, "") : text;
}
const normalized = (text: string) => text.replace(/[\t\n\r ]+/g, " ");
/** DOM mapping is proven by complete leaf-block text and occurrence order, never a quote-only search. */
export function selectedReviewAnchor(root: HTMLElement, markdown: string, selection: Selection | null): ReviewAnchor | null {
  if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const leaf = (node: Node): HTMLElement | null => (node.nodeType === Node.ELEMENT_NODE ? node as HTMLElement : node.parentElement)?.closest("p,h1,h2,h3,h4,h5,h6,li") ?? null;
  const element = leaf(range.startContainer);
  if (!element || element !== leaf(range.endContainer)) return null;
  const elements = leafElements(root);
  const blocks = projectReviewBlocks(markdown).filter(block => block.kind === "paragraph" || block.kind === "heading");
  // Reject any renderer mismatch anywhere before this block, including injected controls.
  const index = elements.indexOf(element);
  if (index < 0 || blocks.length !== elements.length || blocks.some((block, i) => block.selectable && normalized(leafText(elements[i])) !== block.text)) return null;
  const block = blocks[index];
  if (!block.selectable) return null;
  const before = range.cloneRange(); before.selectNodeContents(element); before.setEnd(range.startContainer, range.startOffset);
  const through = range.cloneRange(); through.selectNodeContents(element); through.setEnd(range.endContainer, range.endOffset);
  const startUtf16 = normalized(readableText(before.cloneContents())).length;
  const endUtf16 = normalized(readableText(through.cloneContents())).length;
  const exact = block.text.slice(startUtf16, endUtf16);
  if (!exact.trim() || [...exact].length > 512 || exact !== normalized(readableText(range.cloneContents()))) return null;
  return { schemaVersion: 1, blockPath: block.path, blockKind: block.kind, startUtf16, endUtf16, exact, prefix: [...block.text.slice(0, startUtf16)].slice(-64).join(""), suffix: [...block.text.slice(endUtf16)].slice(0, 64).join("") };
}

/** Build a proven DOM range from canonical offsets, including collapsed soft whitespace.
 * Tight list text excludes nested lists, matching the AST paragraph leaf. */
export function reviewAnchorRange(root: HTMLElement, markdown: string, anchor: ReviewAnchor): Range | null {
  const blocks = projectReviewBlocks(markdown).filter(block => block.kind === "paragraph" || block.kind === "heading");
  const index = blocks.findIndex(block => JSON.stringify(block.path) === JSON.stringify(anchor.blockPath));
  const element = leafElements(root)[index];
  const block = blocks[index];
  if (!element || !block?.selectable || normalized(leafText(element)) !== block.text || block.text.slice(anchor.startUtf16, anchor.endUtf16) !== anchor.exact) return null;
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const extra = node.parentElement?.closest('.sr-only,[aria-hidden="true"]');
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
  const starts: {node: Text; offset: number}[] = [], ends: {node: Text; offset: number}[] = [];
  for (let i = 0; i < chars.length; i++) {
    const first = chars[i];
    starts.push({node:first.node, offset:first.offset});
    if (/[\t\n\r ]/.test(first.value)) while (i + 1 < chars.length && /[\t\n\r ]/.test(chars[i + 1].value)) i++;
    ends.push({node:chars[i].node,offset:chars[i].offset+1});
  }
  const begin = starts[anchor.startUtf16], end = ends[anchor.endUtf16-1];
  if (!begin || !end) return null;
  const range = document.createRange(); range.setStart(begin.node,begin.offset);range.setEnd(end.node,end.offset);
  return normalized(readableText(range.cloneContents())) === anchor.exact ? range : null;
}

/** Focus a current quote without inserting nodes into rendered Markdown. */
export function focusReviewAnchor(root: HTMLElement, markdown: string, anchor: ReviewAnchor) {
  const range = reviewAnchorRange(root,markdown,anchor);
  if (!range) return;
  const element = range.startContainer.parentElement?.closest<HTMLElement>("p,h1,h2,h3,h4,h5,h6,li");
  if (!element) return;
  element.tabIndex = -1; element.focus({ preventScroll: true });
  const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
  element.scrollIntoView({ behavior: "smooth", block: "center" });
}

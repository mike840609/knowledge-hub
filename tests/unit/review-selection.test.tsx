// @vitest-environment jsdom
import { describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownRenderer } from "@/components/knowledge/markdown-renderer";
import * as projection from "@/modules/knowledge/domain/review-anchor";
import { validateReviewAnchor } from "@/modules/knowledge/domain/review-anchor";
import { createReviewRangeResolver, readReviewSelection, reviewAnchorRange, selectedReviewAnchor } from "@/components/knowledge/review-selection";

// Every case is read off the page the reader really draws: the mapping is between that page and the
// Markdown, and a hand-written page would only show that it agrees with itself.
function page(markdown: string) {
  document.body.innerHTML = `<article>${renderToStaticMarkup(<MarkdownRenderer markdown={markdown} />)}</article><p id="elsewhere">Not the document</p>`;
  return document.querySelector<HTMLElement>("article")!;
}

function textNodes(element: Element) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  return nodes;
}

/** Where `text` starts and ends in what `element` holds, across the text nodes it is split over. */
function span(element: Element, text: string) {
  const nodes = textNodes(element);
  const start = nodes.map(node => node.data).join("").indexOf(text);
  if (start < 0) throw new Error(`"${text}" is not in <${element.tagName.toLowerCase()}>`);
  const at = (offset: number, end: boolean) => {
    let passed = 0;
    for (const node of nodes) {
      if (end ? offset <= passed + node.length : offset < passed + node.length) return { node, offset: offset - passed };
      passed += node.length;
    }
    throw new Error("offset outside the element");
  };
  return { from: at(start, false), to: at(start + text.length, true) };
}

function select(from: { node: Node; offset: number }, to: { node: Node; offset: number }) {
  const range = document.createRange();
  range.setStart(from.node, from.offset);
  range.setEnd(to.node, to.offset);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  return selection;
}

/** Selects `text` where `selector` finds it, and reads the selection. */
function choose(root: HTMLElement, markdown: string, selector: string, text: string) {
  const { from, to } = span(root.querySelector(selector)!, text);
  return readReviewSelection(root, markdown, select(from, to));
}

describe("a passage that can take a comment", () => {
  const cases: [name: string, markdown: string, selector: string, text: string, kind: string][] = [
    ["a paragraph", "A 😀 passage", "p", "😀 pass", "paragraph"],
    ["a heading", "## A title here\n\nbody", "h2", "title", "heading"],
    ["a paragraph over a soft line break", "First\nchosen **words**.", "p", "chosen words", "paragraph"],
    ["a paragraph with a link out", "See [reference](https://example.com) here.", "p", "reference", "paragraph"],
    ["struck text", "~~gone~~ kept", "p", "gone kept", "paragraph"],
    ["an item of a tight list", "- One\n- Two", "li + li", "Two", "paragraph"],
    ["an item of a loose list", "- One\n\n- Two", "li + li p", "Two", "paragraph"],
    ["an item that holds a list", "- Parent\n  - Child", "li", "Parent", "paragraph"],
    ["an item of a list in an item", "- Parent\n  - Child", "ul ul li", "Child", "paragraph"],
    ["a quotation", "> Quoted words", "blockquote p", "words", "paragraph"],
    ["the body of a callout", "> [!NOTE]\n> Heads up\n>\n> Second part", "[data-callout] p + p", "Second", "paragraph"],
    ["what a <details> holds", "<details>\n<summary>More</summary>\n\nInside it\n\n</details>", "details p", "Inside", "paragraph"],
    ["a table's heading cell", "| Name | Role |\n|---|---|\n| Ada | Owner |", "th + th", "Role", "tableCell"],
    ["a table's cell", "| Name | Role |\n|---|---|\n| Ada | **Owner** here |", "td + td", "Owner here", "tableCell"],
    ["a line of fenced code", "```\nfirst line\nsecond line\n```", "pre code", "second", "code"],
    ["code over a line break, spaces kept", "```\nif (a) {\n    b();\n}\n```", "pre code", "{\n    b();", "code"],
    ["coloured code, across its tokens", "```js\nconst total = 1;\n```", "pre code", "const total = 1", "code"],
    ["indented code", "para\n\n    indented code\n", "pre code", "indented", "code"],
  ];
  test.each(cases)("%s", (_name, markdown, selector, text, kind) => {
    const root = page(markdown);
    const { anchor, problem } = choose(root, markdown, selector, text);
    expect(problem).toBeUndefined();
    expect(anchor).toMatchObject({ exact: text, blockKind: kind });
    // What the page worked out is what the server works out from the Markdown alone.
    expect(validateReviewAnchor(markdown, anchor!)).toEqual(anchor);
    // And it is found again, in the same place.
    expect(reviewAnchorRange(root, markdown, anchor!)?.toString()).toBe(text);
  });

  test("its place is counted in the Markdown's text, not the page's", () => {
    const markdown = "See [reference](https://example.com) here.";
    // The page adds "(opens in a new tab)" for a screen reader; the Markdown has no such words.
    expect(choose(page(markdown), markdown, "p", "here").anchor).toMatchObject({ startUtf16: 14, endUtf16: 18, prefix: "See reference ", suffix: "." });
  });

  test("it may run past what the page adds for a screen reader, which is no part of it", () => {
    const markdown = "See [reference](https://example.com) here.";
    const root = page(markdown);
    const paragraph = root.querySelector("p")!;
    const anchor = selectedReviewAnchor(root, markdown, select(span(paragraph, "See").from, span(paragraph, "here").to))!;
    expect(anchor.exact).toBe("See reference here");
    expect(validateReviewAnchor(markdown, anchor)).toEqual(anchor);
    expect(reviewAnchorRange(root, markdown, anchor)).not.toBeNull();
  });

  test("its context is counted in characters, as the server counts it", () => {
    const context = "😀".repeat(70);
    const markdown = `${context}chosen`;
    const anchor = choose(page(markdown), markdown, "p", "chosen").anchor!;
    expect([...anchor.prefix]).toHaveLength(64);
    expect(anchor.prefix).toBe("😀".repeat(64));
  });

  test("a selection that ends at the start of what follows is a selection of its own block", () => {
    // A triple click selects a paragraph so: to the very start of the next one.
    const markdown = "Whole paragraph\n\nThe next one";
    const root = page(markdown);
    const [first, second] = Array.from(root.querySelectorAll("p"));
    const reading = readReviewSelection(root, markdown, select({ node: first.firstChild!, offset: 0 }, { node: second, offset: 0 }));
    expect(reading.anchor).toMatchObject({ exact: "Whole paragraph", blockPath: [0] });
  });

  test("a whole code block is selected without the newline the page ends it with", () => {
    const markdown = "```\nall of it\n```\n\nafter";
    const root = page(markdown);
    const code = root.querySelector("pre code")!;
    const reading = readReviewSelection(root, markdown, select({ node: code, offset: 0 }, { node: code, offset: code.childNodes.length }));
    expect(reading.anchor).toMatchObject({ exact: "all of it", blockKind: "code" });
  });
});

describe("a passage that cannot", () => {
  const refused: [name: string, markdown: string, selector: string, text: string][] = [
    ["a paragraph with a wikilink", "See [[Other page]] now", "p", "now"],
    ["a paragraph with a link to another document", "See [doc](./other.md) now", "p", "now"],
    ["a paragraph with an image", "Look ![x](https://e.example/a.png) here", "p", "Look"],
    ["a paragraph with a <br>", "one<br>two", "p", "one"],
    ["a paragraph with a hard line break", "one  \ntwo", "p", "one"],
    ["a paragraph with a drawn HTML tag", "Press <kbd>Ctrl</kbd> now", "p", "Press"],
    ["a paragraph with a footnote's number", "Text here[^1]\n\n[^1]: The note", "p", "Text"],
    ["a footnote", "Text here[^1]\n\n[^1]: The note", "section li p", "note"],
    ["the opening of a callout", "> [!NOTE]\n> Heads up", "[data-callout] p", "Heads"],
    ["a task", "- [ ] todo\n- [x] done", "li", "todo"],
    ["a table cell with a line break", "| a |\n|---|\n| one<br>two |", "td", "one"],
  ];
  test.each(refused)("%s — and says so", (_name, markdown, selector, text) => {
    expect(choose(page(markdown), markdown, selector, text)).toEqual({ problem: "unsupported" });
  });

  // The defect this replaced: a block the page draws differently from the Markdown used to put
  // the count of blocks out, and nothing in the whole document could be commented on.
  const elsewhere = ["> [!NOTE]\n> Heads up", "- [ ] todo\n- [x] done", "Text here[^1]\n\n[^1]: The note", "one<br>two", "<!-- hidden -->", "<div>raw</div>",
    "<details>\n<summary>More</summary>\n\nInside\n\n</details>", "| a | b |\n|---|---|\n| 1 | 2 |", "```js\nconst a = 1;\n```", "- one\n  ```\n  code\n  ```", "![x](https://e.example/a.png)"];
  test.each(elsewhere)("…without taking the rest of the document with it: %j", (block) => {
    for (const markdown of [`${block}\n\nPlain closing passage`, `Plain closing passage\n\n${block}`]) {
      const root = page(markdown);
      const paragraph = Array.from(root.querySelectorAll("p")).find(p => p.textContent === "Plain closing passage")!;
      const { from, to } = span(paragraph, "closing");
      const anchor = selectedReviewAnchor(root, markdown, select(from, to));
      expect(anchor).toMatchObject({ exact: "closing" });
      expect(validateReviewAnchor(markdown, anchor!)).toEqual(anchor);
      expect(reviewAnchorRange(root, markdown, anchor!)?.toString()).toBe("closing");
    }
  });

  test("a selection across two blocks — and says to keep to one", () => {
    const markdown = "First paragraph\n\nSecond paragraph";
    const root = page(markdown);
    const [first, second] = Array.from(root.querySelectorAll("p"));
    expect(readReviewSelection(root, markdown, select(span(first, "paragraph").from, span(second, "Second").to))).toEqual({ problem: "across" });
  });

  test("a selection across two cells of a table", () => {
    const markdown = "| a | b |\n|---|---|\n| left | right |";
    const root = page(markdown);
    const [left, right] = Array.from(root.querySelectorAll("td"));
    expect(readReviewSelection(root, markdown, select(span(left, "left").from, span(right, "right").to))).toEqual({ problem: "across" });
  });

  test("a selection longer than a quote may be — and says how long", () => {
    const markdown = "x".repeat(600);
    expect(choose(page(markdown), markdown, "p", "x".repeat(513))).toEqual({ problem: "long" });
    expect(choose(page(markdown), markdown, "p", "x".repeat(512)).anchor?.exact).toHaveLength(512);
  });

  test("a page that is not the Markdown it is said to be", () => {
    const root = page("Original passage");
    expect(choose(root, "Changed passage", "p", "passage")).toEqual({ problem: "unsupported" });
  });

  test("nothing selected, only space, or something that is not the document: nothing to say", () => {
    const markdown = "A passage here";
    const root = page(markdown);
    const text = root.querySelector("p")!.firstChild!;
    expect(readReviewSelection(root, markdown, null)).toEqual({ problem: "none" });
    expect(readReviewSelection(root, markdown, select({ node: text, offset: 2 }, { node: text, offset: 2 }))).toEqual({ problem: "none" });
    expect(readReviewSelection(root, markdown, select({ node: text, offset: 1 }, { node: text, offset: 2 }))).toEqual({ problem: "none" });
    const outside = document.querySelector("#elsewhere")!.firstChild!;
    expect(readReviewSelection(root, markdown, select({ node: outside, offset: 0 }, { node: outside, offset: 3 }))).toEqual({ problem: "none" });
  });
});

describe("finding a passage again", () => {
  test("a long article is parsed once for many passages, and a changed block is not found", () => {
    const paragraphs = Array.from({ length: 400 }, (_, index) => `Paragraph ${index} for review.`);
    const markdown = paragraphs.join("\n\n");
    const root = page(markdown);
    const parse = vi.spyOn(projection, "projectReviewBlocks");
    try {
      const resolve = createReviewRangeResolver(root, markdown);
      const at = (index: number) => resolve({ schemaVersion: 1, blockPath: [index], blockKind: "paragraph", startUtf16: 0, endUtf16: 9, exact: "Paragraph", prefix: "", suffix: "" });
      expect(Array.from({ length: 20 }, (_, index) => at(index * 20)).every(range => range?.toString() === "Paragraph")).toBe(true);
      expect(parse).toHaveBeenCalledTimes(1);
      root.querySelector("p")!.textContent = "Changed content";
      expect(at(0)).toBeNull();
      expect(at(1)?.toString()).toBe("Paragraph");
    } finally { parse.mockRestore(); }
  });

  test("a passage the Markdown no longer has, or has of another kind, is not found", () => {
    const markdown = "Only paragraph";
    const root = page(markdown);
    const anchor = { schemaVersion: 1 as const, blockPath: [0], blockKind: "paragraph" as const, startUtf16: 0, endUtf16: 4, exact: "Only", prefix: "", suffix: " paragraph" };
    expect(reviewAnchorRange(root, markdown, anchor)?.toString()).toBe("Only");
    expect(reviewAnchorRange(root, markdown, { ...anchor, blockPath: [3] })).toBeNull();
    expect(reviewAnchorRange(root, markdown, { ...anchor, exact: "Onl" })).toBeNull();
  });
});

// @vitest-environment jsdom
import { describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownRenderer } from "@/components/knowledge/markdown-renderer";
import { linkLookupKey } from "@/modules/knowledge/domain/link-graph";
import { parseDocumentHref } from "@/modules/knowledge/domain/document-links";
import * as projection from "@/modules/knowledge/domain/review-anchor";
import { validateReviewAnchor } from "@/modules/knowledge/domain/review-anchor";
import { reviewBlockAnchor, createReviewRangeResolver, focusReviewAnchor, readReviewSelection, reviewAnchorRange, selectedReviewAnchor, selectionAnchorInBlock } from "@/components/knowledge/review-selection";

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
  test("the page marks a footnote's number and an image's label as its own (spec §3c's premise)", () => {
    const root = page("a note[^1] and ![x](https://e.example/a.png) end\n\n[^1]: The note");
    expect(root.querySelector("p [data-footnote-ref]")?.textContent).toBe("1");
    expect(root.querySelector('p [role="img"]')?.textContent).toContain("Image blocked");
  });

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
    ["the opening of a callout", "> [!NOTE]\n> Heads up there", "[data-callout] p", "Heads up", "paragraph"],
    ["the opening of a callout, from its first letter", "> [!WARNING] \n> Heads up there", "[data-callout] p", "Heads", "paragraph"],
    ["the opening of a callout written back by the editor", "> \\[!NOTE]\n> Heads **up** there", "[data-callout] p", "up there", "paragraph"],
    ["a task", "- [ ] todo item\n- [x] done", "li", "todo item", "paragraph"],
    ["a ticked task", "- [ ] todo\n- [x] done item", "li + li", "item", "paragraph"],
    ["a task of a loose list", "- [ ] todo item\n\n- [x] done", "li p", "todo", "paragraph"],
    ["a task that holds a list", "- [ ] parent task\n  - child", "li", "parent", "paragraph"],
    ["a paragraph with a wikilink, after it", "See [[Other page]] now", "p", "now", "paragraph"],
    ["a paragraph with a wikilink, across it", "See [[Other page]] now", "p", "See Other page now", "paragraph"],
    ["a wikilink shown by its alias", "See [[Other page|that one]] now", "p", "that", "paragraph"],
    ["a wikilink to a heading", "See [[Other page#Part two]] now", "p", "Other page › Part", "paragraph"],
    ["a wikilink in emphasis", "See **[[Other page]] closely** now", "p", "page closely", "paragraph"],
    ["a table cell with a wikilink", "| a |\n|---|\n| see [[Wiki page]] here |", "td", "page here", "tableCell"],
    ["a paragraph with a hard line break, before it", "one line  \ntwo lines", "p", "one", "paragraph"],
    ["a paragraph with a hard line break, after it", "one line  \ntwo lines", "p", "two lines", "paragraph"],
    ["a paragraph with a backslash line break", "one line\\\ntwo lines", "p", "two", "paragraph"],
    ["what a <details> holds", "<details>\n<summary>More</summary>\n\nInside it\n\n</details>", "details p", "Inside", "paragraph"],
    ["a table's heading cell", "| Name | Role |\n|---|---|\n| Ada | Owner |", "th + th", "Role", "tableCell"],
    ["a table's cell", "| Name | Role |\n|---|---|\n| Ada | **Owner** here |", "td + td", "Owner here", "tableCell"],
    ["a line of fenced code", "```\nfirst line\nsecond line\n```", "pre code", "second", "code"],
    ["code over a line break, spaces kept", "```\nif (a) {\n    b();\n}\n```", "pre code", "{\n    b();", "code"],
    ["coloured code, across its tokens", "```js\nconst total = 1;\n```", "pre code", "const total = 1", "code"],
    ["indented code", "para\n\n    indented code\n", "pre code", "indented", "code"],
    ["a paragraph with a link to another document, across it", "See [the doc](./other.md) now", "p", "the doc now", "paragraph"],
    ["a paragraph with a blocked image, after it", "Look ![x](https://e.example/a.png) here", "p", "here", "paragraph"],
    ["a paragraph with an image that loads, after it", "Look ![x](./a.png) here", "p", "here", "paragraph"],
    ["a paragraph with a <br>, after it", "one<br>two", "p", "two", "paragraph"],
    ["a paragraph with a comment in it", "one <!-- quiet --> two", "p", "two", "paragraph"],
    ["a table cell with a line break", "| a |\n|---|\n| one<br>two |", "td", "two", "tableCell"],
    ["a paragraph with a footnote's number, before it", "Text here[^1] after\n\n[^1]: The note", "p", "Text here", "paragraph"],
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

  test("a callout's place is counted in the Markdown's text, where its marker is", () => {
    const markdown = "> [!NOTE]\n> Heads up there";
    expect(choose(page(markdown), markdown, "[data-callout] p", "up").anchor).toMatchObject({ blockPath: [0, 0], startUtf16: 14, endUtf16: 16, prefix: "[!NOTE] Heads ", suffix: " there" });
  });

  test("a whole task is selected without the gap the page leaves after its box", () => {
    const markdown = "- [ ] todo item";
    const root = page(markdown);
    const item = root.querySelector("li")!;
    const reading = readReviewSelection(root, markdown, select({ node: item, offset: 0 }, { node: item, offset: item.childNodes.length }));
    expect(reading.anchor).toMatchObject({ exact: "todo item", startUtf16: 0 });
    expect(reviewAnchorRange(root, markdown, reading.anchor!)?.toString()).toBe("todo item");
  });

  test("a wikilink's place is counted in what is shown for it, not in how it is written", () => {
    const markdown = "See [[Other page#Part|that one]] now";
    expect(choose(page(markdown), markdown, "p", "now").anchor).toMatchObject({ startUtf16: 13, endUtf16: 16, prefix: "See that one ", suffix: "" });
  });

  // The owner's reader is given where each link goes; a shared page is given nothing. The words are the same.
  test.each([
    ["one it can follow", { status: "RESOLVED" as const, basePath: "/w/w1/knowledge/s1/d1", title: "Other page", ambiguousWith: 0 }],
    ["one of several it could mean", { status: "RESOLVED" as const, basePath: "/w/w1/knowledge/s1/d1", title: "Other page", ambiguousWith: 2 }],
    ["one that leads nowhere", { status: "UNRESOLVED" as const }],
  ])("a wikilink in the owner's reader, %s, is the same text", (_name, resolution) => {
    const markdown = "See [[Other page]] now";
    const links = { [linkLookupKey("WIKI", "Other page")]: resolution };
    document.body.innerHTML = `<article>${renderToStaticMarkup(<MarkdownRenderer markdown={markdown} links={links} />)}</article>`;
    const root = document.querySelector<HTMLElement>("article")!;
    const paragraph = root.querySelector("p")!;
    // From inside the link to past it, over what the page adds there for a screen reader.
    const anchor = selectedReviewAnchor(root, markdown, select(span(paragraph, "page").from, span(paragraph, "now").to))!;
    expect(anchor).toMatchObject({ exact: "page now", startUtf16: 10 });
    expect(validateReviewAnchor(markdown, anchor)).toEqual(anchor);
    expect(reviewAnchorRange(root, markdown, anchor)).not.toBeNull();
  });

  test.each([
    ["one it can follow", { status: "RESOLVED" as const, basePath: "/w/w1/knowledge/s1/d1", title: "Other page", ambiguousWith: 0 }],
    ["one that leads nowhere", { status: "UNRESOLVED" as const }],
    ["none given, as on a shared page", undefined],
  ])("a link to another document, %s, is the same text", (_name, resolution) => {
    const markdown = "See [the doc](./other.md) now";
    const links = resolution && { [linkLookupKey("PATH", parseDocumentHref("./other.md")!.target)]: resolution };
    document.body.innerHTML = `<article>${renderToStaticMarkup(<MarkdownRenderer markdown={markdown} links={links} />)}</article>`;
    const root = document.querySelector<HTMLElement>("article")!;
    const paragraph = root.querySelector("p")!;
    const anchor = selectedReviewAnchor(root, markdown, select(span(paragraph, "doc").from, span(paragraph, "now").to))!;
    expect(anchor).toMatchObject({ exact: "doc now", startUtf16: 8 });
    expect(validateReviewAnchor(markdown, anchor)).toEqual(anchor);
    expect(reviewAnchorRange(root, markdown, anchor)).not.toBeNull();
  });

  test("a selection across a hard line break is one space of the block's text", () => {
    const markdown = "one line  \ntwo lines";
    const root = page(markdown);
    const paragraph = root.querySelector("p")!;
    const anchor = selectedReviewAnchor(root, markdown, select(span(paragraph, "line").from, span(paragraph, "two").to))!;
    expect(anchor).toMatchObject({ exact: "line two", startUtf16: 4 });
    expect(validateReviewAnchor(markdown, anchor)).toEqual(anchor);
    expect(reviewAnchorRange(root, markdown, anchor)).not.toBeNull();
  });

  test.each([
    ["a footnote's number", "Text here[^1] after\n\n[^1]: The note", "here", "after", "here after", 5],
    ["a blocked image", "Look ![x](https://e.example/a.png) here", "Look", "here", "Look here", 0],
    ["a <br>", "one<br>two", "one", "two", "one two", 0],
  ])("a selection over %s leaves it out of the quote", (_name, markdown, from, to, exact, startUtf16) => {
    const root = page(markdown);
    const paragraph = root.querySelector("p")!;
    const anchor = selectedReviewAnchor(root, markdown, select(span(paragraph, from).from, span(paragraph, to).to))!;
    expect(anchor).toMatchObject({ exact, startUtf16 });
    expect(validateReviewAnchor(markdown, anchor)).toEqual(anchor);
    expect(reviewAnchorRange(root, markdown, anchor)).not.toBeNull();
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
    ["a reference link", "See [doc][d] now\n\n[d]: ./other.md", "p", "now"],
    ["a paragraph with a drawn HTML tag", "Press <kbd>Ctrl</kbd> now", "p", "Press"],
    ["a footnote", "Text here[^1]\n\n[^1]: The note", "section li p", "note"],
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


describe("paragraph comment controls", () => {
  test("anchors the whole formatted paragraph without a browser selection", () => {
    const markdown = "Hello **world** and [link](https://example.com).";
    const root = page(markdown);
    const anchor = reviewBlockAnchor(root.querySelector("p")!, markdown)!;
    expect(anchor.exact).toBe("Hello world and link.");
    expect(anchor.startUtf16).toBe(0);
    expect(reviewAnchorRange(root, markdown, anchor)).not.toBeNull();
  });
  test("bounds a long paragraph at complete Unicode characters", () => {
    const markdown = "😀".repeat(600);
    const root = page(markdown);
    const anchor = reviewBlockAnchor(root.querySelector("p")!, markdown)!;
    expect([...anchor.exact]).toHaveLength(512);
    expect(anchor.endUtf16).toBe(1024);
    expect(reviewAnchorRange(root, markdown, anchor)?.toString()).toBe(anchor.exact);
  });
  test("refuses a DOM paragraph that differs from the saved revision", () => {
    const root = page("Saved text");
    root.querySelector("p")!.textContent = "Unsaved change";
    expect(reviewBlockAnchor(root.querySelector("p")!, "Saved text")).toBeNull();
  });
  test("narrows the block button to the selected words", () => {
    const markdown = `${"filler ".repeat(120)}target words here.`;
    const root = page(markdown);
    const block = reviewBlockAnchor(root.querySelector("p")!, markdown)!;
    expect([...block.exact]).toHaveLength(512);
    const { from, to } = span(root.querySelector("p")!, "target words");
    const narrowed = selectionAnchorInBlock(root, markdown, block, select(from, to));
    expect(narrowed?.exact).toBe("target words");
    expect(narrowed?.blockPath).toEqual(block.blockPath);
  });
  test("keeps the block anchor when the selection is elsewhere, across blocks or collapsed", () => {
    const markdown = "First paragraph here.\n\nSecond paragraph here.";
    const root = page(markdown);
    const block = reviewBlockAnchor(root.querySelector("p")!, markdown)!;
    const elsewhere = span(root.querySelectorAll("p")[1], "paragraph");
    expect(selectionAnchorInBlock(root, markdown, block, select(elsewhere.from, elsewhere.to))).toBeNull();
    const across = select(span(root.querySelectorAll("p")[0], "here.").from, span(root.querySelectorAll("p")[1], "Second").to);
    expect(selectionAnchorInBlock(root, markdown, block, across)).toBeNull();
    const caret = document.createRange();
    caret.setStart(root.querySelector("p")!.firstChild!, 0);
    caret.collapse(true);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(caret);
    expect(selectionAnchorInBlock(root, markdown, block, selection)).toBeNull();
  });
});

describe("finding a quote that is inside a closed disclosure", () => {
  const markdown = "<details>\n<summary>Outer</summary>\n\n<details>\n<summary>Inner</summary>\n\nA hidden passage.\n\n</details>\n\n</details>";

  test("opens every disclosure around it before going to it", () => {
    const root = page(markdown);
    const anchor = choose(root, markdown, "details details p", "hidden").anchor!;
    expect(anchor.exact).toBe("hidden");

    const all = Array.from(root.querySelectorAll("details"));
    expect(all).toHaveLength(2);
    for (const each of all) each.open = false;
    // jsdom lays nothing out, so it has no scrolling of its own.
    const original = Element.prototype.scrollIntoView;
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    try {
      focusReviewAnchor(root, markdown, anchor);

      expect(all.map((each) => each.open)).toEqual([true, true]);
      expect(scrolled).toHaveBeenCalledTimes(1);
      expect(window.getSelection()!.toString()).toBe("hidden");
    } finally { Element.prototype.scrollIntoView = original; }
  });
});

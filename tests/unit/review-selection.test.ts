// @vitest-environment jsdom
import { describe, expect, test } from "vitest";
import { reviewAnchorRange, selectedReviewAnchor } from "@/components/knowledge/review-selection";

function select(html: string, selector: string, start: number, end: number) {
  document.body.innerHTML = `<article>${html}</article>`;
  const root = document.querySelector("article")!;
  const node = root.querySelector(selector)!.firstChild!;
  const range = document.createRange(); range.setStart(node, start); range.setEnd(node, end);
  const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
  return { root, selection };
}

describe("rendered review anchors", () => {
  test("maps a normal paragraph alongside tight lists and blockquotes", () => {
    const { root, selection } = select("<ul><li>One</li><li>Two</li></ul><blockquote><p>Quote</p></blockquote><p>A 😀 passage</p>", "article > p", 2, 4);
    expect(selectedReviewAnchor(root, "- One\n- Two\n\n> Quote\n\nA 😀 passage", selection)).toMatchObject({ blockPath: [2], startUtf16: 2, endUtf16: 4, exact: "😀" });
  });
  test("refuses wiki blocks while permitting another safe paragraph", () => {
    const { root, selection } = select("<p>Safe passage</p><p>Wiki rewritten text</p>", "p", 0, 4);
    expect(selectedReviewAnchor(root, "Safe passage\n\n[[Wiki]]", selection)?.exact).toBe("Safe");
  });
  test("uses Unicode context limits that agree with the server", () => {
    const context = "😀".repeat(70); const { root, selection } = select(`<p>${context}chosen</p>`, "p", 140, 146);
    const anchor = selectedReviewAnchor(root, `${context}chosen`, selection)!;
    expect([...anchor.prefix]).toHaveLength(64); expect(anchor.prefix).toBe("😀".repeat(64));
  });
  test("refuses renderer mismatch and cross-block selections", () => {
    const { root, selection } = select("<p>Changed passage</p>", "p", 0, 7);
    expect(selectedReviewAnchor(root, "Original passage", selection)).toBeNull();
  });
});

test("maps a canonical soft-newline quote back to its original DOM range", () => {
  document.body.innerHTML = "<article><p>First\n  chosen <strong>words</strong>.</p></article>";
  const root=document.querySelector("article")!;
  const range=reviewAnchorRange(root,"First\nchosen **words**.",{schemaVersion:1,blockPath:[0],blockKind:"paragraph",startUtf16:6,endUtf16:18,exact:"chosen words",prefix:"First ",suffix:"."});
  expect(range?.toString()).toBe("chosen words");
});

test("external link accessibility text does not disable other paragraphs or shift offsets", () => {
  const { root, selection } = select('<p>See <a href="https://example.com">reference<span class="sr-only"> (opens in a new tab)</span></a> here.</p><p>Safe passage</p>', 'p + p', 0, 4);
  const markdown = "See [reference](https://example.com) here.\n\nSafe passage";
  expect(selectedReviewAnchor(root, markdown, selection)?.exact).toBe("Safe");
  const paragraph = root.querySelector("p")!;
  const tail = paragraph.lastChild!;
  const selected = document.createRange(); selected.setStart(tail, 1); selected.setEnd(tail, 5);
  selection.removeAllRanges(); selection.addRange(selected);
  const anchor = selectedReviewAnchor(root, markdown, selection)!;
  expect(anchor).toMatchObject({ exact: "here", startUtf16: 14, endUtf16: 18 });
  expect(reviewAnchorRange(root, markdown, anchor)?.toString()).toBe("here");
  selected.setStart(paragraph.firstChild!, 0);
  selection.removeAllRanges(); selection.addRange(selected);
  const spanning = selectedReviewAnchor(root, markdown, selection)!;
  expect(spanning.exact).toBe("See reference here");
  expect(reviewAnchorRange(root, markdown, spanning)).not.toBeNull();
});

test("tight nested list structure does not disable selection or highlights in other blocks", () => {
  const { root, selection } = select('<ul>\n<li>Parent\n<ul>\n<li>Child</li>\n</ul>\n</li>\n</ul>\n<p>Safe passage</p>', 'p', 0, 4);
  const markdown = "- Parent\n  - Child\n\nSafe passage";
  const anchor = selectedReviewAnchor(root, markdown, selection)!;
  expect(anchor).toMatchObject({ exact: "Safe", blockPath: [1] });
  expect(reviewAnchorRange(root, markdown, anchor)?.toString()).toBe("Safe");
});

test("nested tight-list parent and child keep their own canonical selection and highlight ranges", () => {
  const markdown = "- Parent\n  - Child";
  for (const [selector, exact] of [["article > ul > li", "Parent"], ["article ul ul li", "Child"]]) {
    const { root, selection } = select('<ul><li>Parent\n<ul><li>Child</li></ul>\n</li></ul>', selector, 0, exact.length);
    const anchor = selectedReviewAnchor(root, markdown, selection)!;
    expect(anchor.exact).toBe(exact);
    expect(reviewAnchorRange(root, markdown, anchor)?.toString()).toBe(exact);
  }
});

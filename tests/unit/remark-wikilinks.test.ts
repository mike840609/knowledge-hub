import type { Root } from "mdast";
import { describe, expect, it } from "vitest";
import { remarkWikiLinks } from "@/components/knowledge/editor/remark-wikilinks";
import { remarkKnowledgeLinks } from "@/components/knowledge/remark-knowledge-links";
import { parseMarkdown } from "@/shared/markdown/parse";

type Shape = { type: string; value?: string; children?: Shape[] };

/** The tree with positions and data left out — what is in it, not where it came from. */
function shape(node: Shape): Shape {
  const out: Shape = { type: node.type };
  if (node.value !== undefined) out.value = node.value;
  if (node.children) out.children = node.children.map(shape);
  return out;
}

/** Parse as the renderer and the link index do, then run the plugin as Milkdown does (the Markdown is the "file"). */
function run(markdown: string, plugin: () => (tree: Root, file: { toString(): string }) => void = remarkWikiLinks): Root {
  const tree = parseMarkdown(markdown);
  plugin()(tree, markdown);
  return tree;
}

/** The first paragraph's children (or the given block's), shaped. */
function inline(markdown: string) {
  const tree = run(markdown);
  return (shape(tree as unknown as Shape).children![0].children ?? []) as Shape[];
}

const text = (value: string): Shape => ({ type: "text", value });
const wiki = (value: string): Shape => ({ type: "wikiLink", value });

describe("remarkWikiLinks", () => {
  it("cuts a wikilink out of its text and keeps the text around it", () => {
    expect(inline("See [[Alpha]], [[Beta|the beta]] and [[Gamma#Setup]] here.")).toEqual([
      text("See "),
      wiki("[[Alpha]]"),
      text(", "),
      wiki("[[Beta|the beta]]"),
      text(" and "),
      wiki("[[Gamma#Setup]]"),
      text(" here."),
    ]);
  });

  it("leaves no empty text node at either end or between two links", () => {
    expect(inline("[[A]][[B]]")).toEqual([wiki("[[A]]"), wiki("[[B]]")]);
    expect(inline("[[Only]]")).toEqual([wiki("[[Only]]")]);
  });

  it("keeps the link as written: spaces, alias, heading, block id", () => {
    expect(inline("[[  Spaced  #  Head  |  shown  ]] and [[Note#^abc123]]")).toEqual([wiki("[[  Spaced  #  Head  |  shown  ]]"), text(" and "), wiki("[[Note#^abc123]]")]);
  });

  it("does not touch a wikilink the author escaped, and keeps the text around it as one piece", () => {
    expect(inline("\\[\\[literal\\]\\] and [[Real]]")).toEqual([text("[[literal]] and "), wiki("[[Real]]")]);
    expect(inline("\\[\\[only escaped\\]\\]")).toEqual([text("[[only escaped]]")]);
  });

  it("does not touch an embed", () => {
    expect(inline("![[Image.png]] and [[Real]]")).toEqual([text("![[Image.png]] and "), wiki("[[Real]]")]);
  });

  it("does not touch what is shown rather than written: code, raw HTML, a link's own text", () => {
    const tree = shape(run(["`[[inline]]`", "", "```", "[[fenced]]", "```", "", "<div>[[html]]</div>", "", "[see [[Inner]]](outer.md)"].join("\n")) as unknown as Shape);
    const kinds = JSON.stringify(tree);
    expect(kinds).not.toContain("wikiLink");
    expect(kinds).toContain("[[inline]]");
    expect(kinds).toContain("[[fenced]]");
    expect(kinds).toContain("see [[Inner]]");
  });

  it("finds a link wherever a reader would: emphasis, headings, lists, quotes, table cells", () => {
    const tree = JSON.stringify(shape(run(["**bold [[InBold]]**", "", "## About [[InHeading]]", "", "- [[InList]]", "", "> [[InQuote]]", "", "| a |", "| - |", "| [[InTable]] |"].join("\n")) as unknown as Shape));
    for (const link of ["InBold", "InHeading", "InList", "InQuote", "InTable"]) expect(tree).toContain(`{"type":"wikiLink","value":"[[${link}]]"}`);
  });

  it("gives the alias's pipe as it reads in the text, not as it was written in a table cell", () => {
    const tree = shape(run("| a |\n| - |\n| [[Note\\|shown]] |") as unknown as Shape);
    expect(JSON.stringify(tree)).toContain('{"type":"wikiLink","value":"[[Note|shown]]"}');
  });

  it("makes no node of `[[]]`, `[[#]]` or a link split across lines", () => {
    expect(JSON.stringify(shape(run("[[]] and [[#]] and [[broken\nlink]]") as unknown as Shape))).not.toContain("wikiLink");
  });

  it("judges a text node with no position by its value alone, as the reader does", () => {
    const tree: Root = { type: "root", children: [{ type: "paragraph", children: [{ type: "text", value: "a [[X]] b" }] }] };
    remarkWikiLinks()(tree, "a [[X]] b");
    expect(shape(tree as unknown as Shape).children![0].children).toEqual([text("a "), wiki("[[X]]"), text(" b")]);
  });

  it("leaves a document with no wikilink exactly as it was", () => {
    const markdown = "# Title\n\nSome *text* with `code` and [a link](https://example.com).\n\n- one\n- two\n";
    expect(shape(run(markdown) as unknown as Shape)).toEqual(shape(parseMarkdown(markdown) as unknown as Shape));
  });
});

describe("the reader and the editor take the same links", () => {
  // Both walk the tree through `replaceWikiLinks`; this pins that they cannot be told apart by what they find.
  const documents = [
    "See [[Alpha]] and [[Beta|b]].",
    "\\[\\[escaped\\]\\] and [[Real]]",
    "`[[code]]` [[Real]] ![[embed]]",
    "[see [[Inner]]](outer.md) and [[Outer]]",
    "| a |\n| - |\n| [[Cell\\|alias]] |",
    "> [[Quote]]\n\n- [[Item]]\n\n## [[Heading]]",
  ];

  const count = (tree: Root, type: string) => JSON.stringify(tree).split(`"type":"${type}"`).length - 1;

  it.each(documents)("%s", (markdown) => {
    const editor = run(markdown, remarkWikiLinks);
    const reader = run(markdown, remarkKnowledgeLinks);
    // The reader turns a wikilink into a `link` with a `wikiLink` marker on its data; count those against ours.
    const readerLinks = JSON.stringify(reader).split('"data-kh-wikilink"').length - 1 + (JSON.stringify(reader).split('"data-kh-anchor"').length - 1);
    expect(count(editor, "wikiLink")).toBe(readerLinks);
  });
});

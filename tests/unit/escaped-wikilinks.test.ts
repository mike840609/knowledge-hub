import { gfmToMarkdown } from "mdast-util-gfm";
import { toMarkdown } from "mdast-util-to-markdown";
import { describe, expect, it } from "vitest";
import { findEscapedWikiLinks } from "@/modules/knowledge/domain/escaped-wikilinks";
import { parseMarkdown } from "@/shared/markdown/parse";
import { LINK_MARKDOWN_FIXTURES } from "../fixtures/link-markdown";

const texts = (markdown: string) => findEscapedWikiLinks(markdown).map((found) => found.text);

describe("findEscapedWikiLinks", () => {
  it("finds a wikilink written with its opening brackets escaped, in every form", () => {
    expect(texts("See \\[\\[Alpha]], \\[\\[Beta|the beta]], \\[\\[Gamma#Setup]] and \\[\\[Delta#Setup|d]].")).toEqual([
      "\\[\\[Alpha]]",
      "\\[\\[Beta|the beta]]",
      "\\[\\[Gamma#Setup]]",
      "\\[\\[Delta#Setup|d]]",
    ]);
    expect(texts("\\[\\[請假流程]] and \\[\\[Notes/Source]]")).toEqual(["\\[\\[請假流程]]", "\\[\\[Notes/Source]]"]);
  });

  it("says which line each is on, counting from the start of the document", () => {
    const markdown = ["# Title", "", "first \\[\\[A]]", "second line \\[\\[B]]", "", "- item \\[\\[C]]"].join("\n");
    expect(findEscapedWikiLinks(markdown).map((found) => [found.line, found.text])).toEqual([
      [3, "\\[\\[A]]"],
      [4, "\\[\\[B]]"],
      [6, "\\[\\[C]]"],
    ]);
  });

  it("finds one in a list, a quote, a heading and a table cell, where the alias's pipe is escaped", () => {
    const markdown = ["- \\[\\[InList]]", "", "> \\[\\[InQuote]]", "", "## \\[\\[InHeading]]", "", "| a |", "| - |", "| \\[\\[Note\\|shown]] |"].join("\n");
    expect(texts(markdown)).toEqual(["\\[\\[InList]]", "\\[\\[InQuote]]", "\\[\\[InHeading]]", "\\[\\[Note\\|shown]]"]);
  });

  it("does not take one the author escaped on purpose, closing brackets and all", () => {
    expect(texts("\\[\\[literal\\]\\] and a half one \\[\\[half\\]]")).toEqual([]);
  });

  it("does not take a working wikilink, or brackets that are shown as code", () => {
    expect(texts("[[Real]] and `\\[\\[inline]]`")).toEqual([]);
    expect(texts(["```", "\\[\\[fenced]]", "```", "", "    \\[\\[indented]]", "", "<div>\\[\\[html]]</div>"].join("\n"))).toEqual([]);
  });

  it("does not take an embed", () => {
    expect(texts("!\\[\\[Image.png]]")).toEqual([]);
  });

  it("does not take the text of a link as the editor wrote it, brackets escaped on both sides", () => {
    expect(texts("[see \\[\\[Inner\\]\\]](outer.md)")).toEqual([]);
  });

  // The shape cannot tell damage from intent: a link escaped on purpose and then saved from the
  // rendered editor came back as `\[\[x]]`, like any other. So these are candidates, and the report says so.
  it("also takes a link that was escaped on purpose and then saved from the old editor", () => {
    const savedByTheOldEditor = toMarkdown(parseMarkdown("\\[\\[literal\\]\\] on purpose"), { extensions: [gfmToMarkdown()] });
    expect(savedByTheOldEditor).toBe("\\[\\[literal]] on purpose\n");
    expect(texts(savedByTheOldEditor)).toEqual(["\\[\\[literal]]"]);
  });

  it("does not take brackets spanning a line break or holding other brackets", () => {
    expect(texts("\\[\\[broken\nlink]] and \\[\\[a [b] c]]")).toEqual([]);
  });

  it("returns nothing for a document with no escaped brackets, without parsing it", () => {
    expect(findEscapedWikiLinks("")).toEqual([]);
    expect(findEscapedWikiLinks("# Title\n\nPlain text and [[Real]].")).toEqual([]);
  });

  // The shape has to be what the editor really wrote, not what this file guesses it wrote: take the
  // extractor's own cases, write each out the way the editor did (a text node with `[[x]]` in it,
  // stringified), and require every wikilink of the case to be found again.
  describe("finds what the old editor wrote for each of the extractor's cases", () => {
    // Not the cases that hold an escaped bracket: those are written out with the same shape as damage (below),
    // which is the point of them, and not a wikilink to be found again.
    const wikilinkCases = LINK_MARKDOWN_FIXTURES.filter((fixture) => fixture.links.some((link) => link.kind === "WIKI") && !fixture.markdown.includes("\\["));

    it("has cases to hold it to", () => {
      expect(wikilinkCases.length).toBeGreaterThanOrEqual(20);
    });

    it.each(wikilinkCases)("$name", ({ markdown, links }) => {
      const written = toMarkdown(parseMarkdown(markdown), { extensions: [gfmToMarkdown()] });
      const wanted = links.filter((link) => link.kind === "WIKI").length;
      expect(findEscapedWikiLinks(written).length).toBe(wanted);
    });
  });
});

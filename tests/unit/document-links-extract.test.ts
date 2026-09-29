import { describe, expect, it } from "vitest";
import {
  extractDocumentLinks,
  MAX_LINKS_PER_DOCUMENT,
  parseDocumentHref,
  parseWikiLinkBody,
} from "@/modules/knowledge/domain/document-links";

const links = (markdown: string) => extractDocumentLinks(markdown).map(({ kind, target, fragment, display }) => ({ kind, target, fragment, display }));

describe("parseWikiLinkBody", () => {
  it("splits target, heading and alias", () => {
    expect(parseWikiLinkBody("Note")).toEqual({ target: "Note", fragment: null, alias: null });
    expect(parseWikiLinkBody("Note|shown")).toEqual({ target: "Note", fragment: null, alias: "shown" });
    expect(parseWikiLinkBody("Note#Setup")).toEqual({ target: "Note", fragment: "Setup", alias: null });
    expect(parseWikiLinkBody("Note#Setup|shown")).toEqual({ target: "Note", fragment: "Setup", alias: "shown" });
    expect(parseWikiLinkBody("Folder/Note")).toEqual({ target: "Folder/Note", fragment: null, alias: null });
  });

  it("keeps a pipe inside the alias", () => {
    expect(parseWikiLinkBody("Note|a|b")).toEqual({ target: "Note", fragment: null, alias: "a|b" });
  });

  it("trims and treats empty parts as absent", () => {
    expect(parseWikiLinkBody("  Note  #  Setup  |  shown  ")).toEqual({ target: "Note", fragment: "Setup", alias: "shown" });
    expect(parseWikiLinkBody("Note|")).toEqual({ target: "Note", fragment: null, alias: null });
    expect(parseWikiLinkBody("Note#")).toEqual({ target: "Note", fragment: null, alias: null });
  });

  it("drops a block id but keeps the link", () => {
    expect(parseWikiLinkBody("Note#^abc123")).toEqual({ target: "Note", fragment: null, alias: null });
  });

  it("has no edge without a target", () => {
    expect(parseWikiLinkBody("#Heading")).toBeNull();
    expect(parseWikiLinkBody("|alias")).toBeNull();
    expect(parseWikiLinkBody("   ")).toBeNull();
  });
});

describe("parseDocumentHref", () => {
  it("accepts a relative path to a Markdown file", () => {
    expect(parseDocumentHref("note.md")).toEqual({ target: "note.md", fragment: null });
    expect(parseDocumentHref("../notes/b.md")).toEqual({ target: "../notes/b.md", fragment: null });
    expect(parseDocumentHref("./b.markdown")).toEqual({ target: "./b.markdown", fragment: null });
    expect(parseDocumentHref("/root/b.MD")).toEqual({ target: "/root/b.MD", fragment: null });
  });

  it("splits the fragment and drops a query", () => {
    expect(parseDocumentHref("b.md#Local-Setup")).toEqual({ target: "b.md", fragment: "Local-Setup" });
    expect(parseDocumentHref("b.md?plain=1#x")).toEqual({ target: "b.md", fragment: "x" });
  });

  it("decodes escapes, and keeps a stray percent sign", () => {
    expect(parseDocumentHref("My%20Note.md")).toEqual({ target: "My Note.md", fragment: null });
    expect(parseDocumentHref("%E8%AB%8B%E5%81%87.md#%E6%B5%81%E7%A8%8B")).toEqual({ target: "請假.md", fragment: "流程" });
    expect(parseDocumentHref("100%.md")).toEqual({ target: "100%.md", fragment: null });
  });

  it("is not a document link for anything else", () => {
    for (const url of ["https://example.com/a.md", "http://x/a.md", "mailto:a@b.c", "//cdn.example.com/a.md", "#section", "", "image.png", "report.pdf", "dir/", "notes", "a.mdx"]) {
      expect(parseDocumentHref(url), url).toBeNull();
    }
  });
});

describe("extractDocumentLinks", () => {
  it("finds wikilinks in every form", () => {
    expect(links("See [[Alpha]], [[Beta|the beta]], [[Gamma#Setup]] and [[Delta#Setup|d]].")).toEqual([
      { kind: "WIKI", target: "Alpha", fragment: null, display: null },
      { kind: "WIKI", target: "Beta", fragment: null, display: "the beta" },
      { kind: "WIKI", target: "Gamma", fragment: "Setup", display: null },
      { kind: "WIKI", target: "Delta", fragment: "Setup", display: "d" },
    ]);
  });

  it("finds path-qualified and non-Latin names", () => {
    expect(links("[[Notes/Source]] and [[請假流程]]").map((link) => link.target)).toEqual(["Notes/Source", "請假流程"]);
  });

  it("finds relative Markdown links, inline and by reference", () => {
    expect(links("[b](../b.md) and [c][ref] and [d](<My Note.md>)\n\n[ref]: c.md#top\n")).toEqual([
      { kind: "PATH", target: "../b.md", fragment: null, display: "b" },
      { kind: "PATH", target: "c.md", fragment: "top", display: "c" },
      { kind: "PATH", target: "My Note.md", fragment: null, display: "d" },
    ]);
  });

  it("returns links in reading order across both syntaxes", () => {
    const found = extractDocumentLinks("[[One]] then [two](two.md) then [[Three]]");
    expect(found.map((link) => [link.ordinal, link.target])).toEqual([[0, "One"], [1, "two.md"], [2, "Three"]]);
  });

  it("does not treat an embed as a link", () => {
    expect(links("![[Image.png]] and ![[Other note]] but [[Real]]")).toEqual([
      { kind: "WIKI", target: "Real", fragment: null, display: null },
    ]);
  });

  it("does not see brackets that are being shown, not written", () => {
    const markdown = ["`[[inline]]`", "", "```", "[[fenced]]", "```", "", "    [[indented]]", "", "<div>[[html]]</div>", "", "kept [[Real]]"].join("\n");
    expect(links(markdown).map((link) => link.target)).toEqual(["Real"]);
  });

  it("does not see an escaped wikilink", () => {
    expect(links("\\[\\[literal\\]\\] and [[Real]]").map((link) => link.target)).toEqual(["Real"]);
  });

  it("leaves other links alone", () => {
    expect(links("[site](https://example.com/a.md) [pic](img.png) [anchor](#part) [pdf](a.pdf) <https://example.com>")).toEqual([]);
  });

  it("does not turn the text of a link into a second link", () => {
    expect(links("[see [[Inner]]](outer.md)").map((link) => link.target)).toEqual(["outer.md"]);
  });

  it("does not span lines or nest", () => {
    expect(links("[[broken\nlink]] and [[a [[b]] c]]").map((link) => link.target)).toEqual(["b"]);
  });

  it("finds wikilinks in tables, lists, quotes and headings", () => {
    const markdown = ["| a | b |", "| - | - |", "| [[InTable]] | x |", "", "- [[InList]]", "", "> [[InQuote]]", "", "## About [[InHeading]]"].join("\n");
    expect(links(markdown).map((link) => link.target)).toEqual(["InTable", "InList", "InQuote", "InHeading"]);
  });

  it("finds a wikilink with an escaped pipe in a table cell", () => {
    const markdown = ["| a |", "| - |", "| [[Note\\|shown]] |"].join("\n");
    expect(links(markdown)).toEqual([{ kind: "WIKI", target: "Note", fragment: null, display: "shown" }]);
  });

  it("does not see a wikilink split by emphasis (documented limit)", () => {
    expect(links("[[*starred*]]")).toEqual([]);
  });

  it("numbers lines within the body", () => {
    const found = extractDocumentLinks("first\n\nsecond [[A]]\nthird [[B]]\n\n[c](c.md)");
    expect(found.map((link) => [link.target, link.line])).toEqual([["A", 3], ["B", 4], ["c.md", 6]]);
  });

  it("numbers lines for a link late in a multi-line paragraph", () => {
    const found = extractDocumentLinks("line one\nline two\nline three with [[Late]]");
    expect(found[0].line).toBe(3);
  });

  describe("the parse is skipped for a document that cannot link (a superset check, never a filter)", () => {
    it("still finds every spelling of a link to a Markdown file", () => {
      for (const markdown of [
        "[a](b.md)",
        "[a](b.MD)",
        "[a](dir/b.markdown#top)",
        "[a](<My Note.md>)",
        "[a][r]\n\n[r]: c.md",
        "[a](b%2Emd)",
        "[a](b.%6Dd)",
        "[[Wiki]]",
        "text [[Wiki|alias]] text",
      ]) {
        expect(extractDocumentLinks(markdown).length, markdown).toBeGreaterThan(0);
      }
    });

    it("finds nothing, and does not need to look, in a document with no [[ and no .md", () => {
      expect(extractDocumentLinks("# Title\n\n- [ ] a task\n- [x] done\n\n[site](https://example.com) and [pic](a.png) and `code`.")).toEqual([]);
    });
  });

  it("returns nothing for text with no brackets, without parsing", () => {
    expect(extractDocumentLinks("plain text with no links")).toEqual([]);
    expect(extractDocumentLinks("")).toEqual([]);
  });

  it("caps a document's links", () => {
    const many = Array.from({ length: MAX_LINKS_PER_DOCUMENT + 50 }, (_, index) => `[[Note ${index}]]`).join(" ");
    const found = extractDocumentLinks(many);
    expect(found).toHaveLength(MAX_LINKS_PER_DOCUMENT);
    expect(found.at(-1)?.ordinal).toBe(MAX_LINKS_PER_DOCUMENT - 1);
  });

  it("skips a target too long to store and truncates an overlong alias on a code point", () => {
    const longTarget = "x".repeat(513);
    const alias = "😀".repeat(600);
    const found = extractDocumentLinks(`[[${longTarget}]] [[Ok|${alias}]]`);
    expect(found).toHaveLength(1);
    expect(found[0].target).toBe("Ok");
    expect(Array.from(found[0].display ?? "")).toHaveLength(512);
  });

  it("is deterministic", () => {
    const markdown = "[[A]] [b](b.md) [[C#D|e]]";
    expect(extractDocumentLinks(markdown)).toEqual(extractDocumentLinks(markdown));
  });
});

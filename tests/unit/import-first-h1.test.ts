import { fromMarkdown } from "mdast-util-from-markdown";
import { toString } from "mdast-util-to-string";
import { describe, expect, it } from "vitest";
import { parseGenericMarkdownText } from "@/modules/sources/adapters/generic-markdown-folder-adapter";

/** The rule, read off a parse of the whole note: the first non-empty top-level H1. */
function wholeNoteH1(markdown: string): string | null {
  for (const node of fromMarkdown(markdown).children) {
    if (node.type === "heading" && node.depth === 1 && toString(node).trim()) return toString(node).trim();
  }
  return null;
}

function titleOf(markdown: string): { title: string; source: string } {
  const parsed = parseGenericMarkdownText({ sourcePath: "notes/file-name.md", text: markdown, sourceFileHash: "h" });
  return { title: parsed.resolvedTitle, source: parsed.titleSource };
}

const long = "Body paragraph with *emphasis* and `code`.\n\n".repeat(200);

const cases: Record<string, string> = {
  "ATX at the top": `# Title\n\n${long}`,
  "ATX after a paragraph": `Intro line\n# Title\n${long}`,
  "ATX with closing hashes": `#   Title ##\n${long}`,
  "setext": `Title\n=====\n\n${long}`,
  "setext over two lines": `Multi\nline title\n===\n${long}`,
  "CRLF setext": `Title\r\n===\r\n\r\n${long.replace(/\n/g, "\r\n")}`,
  "CRLF ATX": `# Title\r\n${long.replace(/\n/g, "\r\n")}`,
  "H1 inside a fenced code block first": "```\n# not a title\n```\n\n# Real\n" + long,
  "H1 inside an unclosed fence": "```\n# never\n" + long,
  "H1 in a list item": `- item\n  # nested\n\n# Real\n${long}`,
  "H1 in a block quote": `> # quoted\n\n# Real\n${long}`,
  "empty ATX before the real one": `#\n\n# Real\n${long}`,
  "H2 only": `## Sub\n${long}`,
  "=== under a blank line": `\n===\n\n${long}`,
  "four-space indent is code": `    # code\n\n${long}`,
  "reference link defined later": `# See [the guide][g]\n\n${long}\n[g]: https://example.com\n`,
  "reference link never defined": `# See [the guide][g]\n\n${long}`,
  "inline link": `# See [guide](https://example.com)\n${long}`,
  "HTML block before": `<div>\n# inside html\n</div>\n\n# Real\n${long}`,
  "H1 at the very end, no newline": `${long}# Last`,
  "no H1 at all": long,
  "empty note": "",
};

describe("the H1 an imported note is titled by", () => {
  it.each(Object.entries(cases))("matches a whole-note parse: %s", (_name, markdown) => {
    const h1 = wholeNoteH1(markdown);
    expect(titleOf(markdown)).toEqual(h1 ? { title: h1, source: "H1" } : { title: "file-name", source: "FILENAME" });
  });

  it("still reports a frontmatter title that differs from the H1", () => {
    const parsed = parseGenericMarkdownText({ sourcePath: "a.md", text: `---\ntitle: Front\n---\n# Heading\n${long}`, sourceFileHash: "h" });
    expect(parsed.resolvedTitle).toBe("Front");
    expect(parsed.diagnostics).toEqual([expect.objectContaining({ code: "TITLE_CONFLICT", details: { frontmatterTitle: "Front", h1: "Heading" } })]);
  });
});

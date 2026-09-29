import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownRenderer } from "@/components/knowledge/markdown-renderer";
import { extractOutline } from "@/shared/markdown/outline";

function renderedHeadingIds(markdown: string): string[] {
  const html = renderToStaticMarkup(<MarkdownRenderer markdown={markdown} />);
  return [...html.matchAll(/<h[1-6][^>]*\bid="([^"]*)"/g)].map((match) => match[1]);
}

/**
 * The outline is built from one parse and the page from another, and the only
 * thing that keeps a click on an outline entry landing on its heading is that
 * both ask the same function for the slug. This is that promise, checked
 * against the shapes that make the two parses easiest to pull apart.
 */
describe("heading ids in the rendered document", () => {
  const cases: Record<string, string> = {
    plain: "# Title\n\n## Setup\n\n## Usage\n",
    "repeated headings": "## Notes\n\ntext\n\n## Notes\n\n## Notes\n",
    "CJK headings": "## 請假流程\n\n## 加班申請\n\n### 請假流程\n",
    "GFM strikethrough and autolink in a heading": "## A ~~gone~~ heading\n\n## See https://example.com/x\n",
    "inline code and emphasis": "## Use `npm ci` **now**\n\n## _Emphasis_ first\n",
    "setext headings": "Title\n=====\n\nSub\n---\n\ntext\n",
    "heading inside a blockquote and a list": "> ## Quoted\n\n- item\n\n  ## Nested\n\n## Top\n",
    "suffix collision": "## Setup\n\n## Setup\n\n## Setup 1\n\n## Setup\n",
  };

  for (const [name, markdown] of Object.entries(cases)) {
    it(`gives every heading the id the outline links to: ${name}`, () => {
      const ids = renderedHeadingIds(markdown);
      const outlined = extractOutline(markdown).map((entry) => entry.slug);
      expect(ids.length).toBeGreaterThan(0);
      // Every outline entry is a rendered id, in the same order. (The outline
      // may list fewer: it stops at depth four and needs two entries.)
      expect(ids.filter((id) => outlined.includes(id))).toEqual(outlined);
    });
  }

  it("makes an in-page anchor written elsewhere reach its heading", () => {
    const markdown = "See [local setup](#local-setup).\n\n## Local Setup\n";
    const html = renderToStaticMarkup(<MarkdownRenderer markdown={markdown} />);
    expect(html).toContain('href="#local-setup"');
    expect(html).toContain('id="local-setup"');
  });

  it("does not give ids to things that are not headings", () => {
    expect(renderedHeadingIds("```\n# not a heading\n```\n\nplain **bold**\n")).toEqual([]);
  });
});

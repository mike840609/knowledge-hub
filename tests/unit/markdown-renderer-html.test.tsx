import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownRenderer } from "@/components/knowledge/markdown-renderer";

function render(markdown: string): string {
  return renderToStaticMarkup(<MarkdownRenderer markdown={markdown} />);
}

/**
 * The editor writes an empty paragraph as `<br />` and reads it back as one; generated Markdown
 * puts `<br>` in table cells, where nothing else breaks a line. The reader has to show both as
 * the line break they are, not as the tag's text — and a comment not at all.
 */
describe("the HTML the reader understands", () => {
  it.each([
    ["the editor's empty paragraph", "before\n\n<br />\n\nafter\n"],
    ["a break inside a table cell", "| a | b |\n| - | - |\n| one<br>two | 2 |\n"],
    ["a break inside a paragraph", "one<br/>two\n"],
    ["upper case, with spaces", "one<BR  />two\n"],
  ])("is a line break: %s", (_name, markdown) => {
    const html = render(markdown);
    expect(html).toContain("<br/>");
    expect(html).not.toContain("&lt;br");
  });

  it("keeps a break inside its table cell", () => {
    expect(render("| a |\n| - |\n| one<br>two |\n")).toMatch(/<td>one<br\/>\s*two<\/td>/);
  });

  it.each([
    ["inline code", "write `<br>` for a break\n"],
    ["a code block", "```html\n<br />\n```\n"],
  ])("leaves the tag as text in %s", (_name, markdown) => {
    // The highlighter wraps the tag's parts in spans; what is read is the text.
    expect(render(markdown).replace(/<[^>]+>/g, "")).toMatch(/&lt;br ?\/?&gt;/);
  });

  it.each([
    ["on its own line", "before\n\n<!-- a note -->\n\nafter\n"],
    ["over several lines", "before\n\n<!--\na note\nmore\n-->\n\nafter\n"],
    ["inside a paragraph", "before <!-- a note --> after\n"],
    ["inside a table cell", "| a |\n| - |\n| before<!-- a note -->after |\n"],
  ])("does not show a comment %s", (_name, markdown) => {
    const html = render(markdown);
    expect(html).not.toContain("a note");
    expect(html).not.toContain("&lt;!--");
    expect(html).toContain("before");
    expect(html).toContain("after");
  });

  it("leaves a comment as text in a code block", () => {
    expect(render("```html\n<!-- a note -->\n```\n").replace(/<[^>]+>/g, "")).toContain("&lt;!-- a note --&gt;");
  });

  it("renders no other HTML: the rest stays text", () => {
    const html = render("<div onclick=\"x()\">hi</div>\n\na <script>alert(1)</script> b<br>c\n");
    expect(html).not.toMatch(/<div onclick|<script/);
    expect(html).toContain("&lt;div");
  });

  it.each([
    ["an external link", "[x](https://x.test)\n"],
    ["an in-page link", "[x](#there)\n"],
    ["a footnote", "text[^1]\n\n[^1]: note\n"],
  ])("puts no syntax node on %s", (_name, markdown) => {
    const html = render(markdown);
    expect(html).toContain("<a ");
    expect(html).not.toContain("node=");
  });
});

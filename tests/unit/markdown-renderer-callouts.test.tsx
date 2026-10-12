import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { withoutReviewPaths } from "../fixtures/rendered-markdown";
import { MarkdownBase } from "@/components/knowledge/markdown-base";
import { MarkdownRenderer } from "@/components/knowledge/markdown-renderer";

const render = (markdown: string) => withoutReviewPaths(renderToStaticMarkup(<MarkdownRenderer markdown={markdown} />));
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
/** The callouts of a page: the kind each was given, and its opening tag. */
const callouts = (html: string) => [...html.matchAll(/<(\w+)[^>]*\bdata-callout="([^"]*)"[^>]*>/g)].map((match) => ({ tag: match[1], kind: match[2], open: match[0] }));

/**
 * `> [!NOTE]` and its four siblings, as GitHub writes them
 * (docs/superpowers/specs/2026-10-12-reader-callouts-design.md).
 */
describe("callouts in the rendered document", () => {
  it.each([
    ["NOTE", "note", "Note"],
    ["TIP", "tip", "Tip"],
    ["IMPORTANT", "important", "Important"],
    ["WARNING", "warning", "Warning"],
    ["CAUTION", "caution", "Caution"],
  ])("shows [!%s] as a callout titled by its kind, without the marker", (marker, kind, title) => {
    const html = render(`> [!${marker}]\n> Mind the gap.\n`);
    expect(callouts(html)).toEqual([expect.objectContaining({ kind })]);
    expect(html).not.toContain("<blockquote");
    expect(text(html)).toBe(`${title} Mind the gap.`);
  });

  it.each([
    ["in lower case", "> [!note]\n> body\n"],
    ["as the editor writes it back, escaped", "> \\[!NOTE]\n> body\n"],
    ["followed by spaces", "> [!NOTE]   \n> body\n"],
    ["followed by a hard break", "> [!NOTE]\\\n> body\n"],
    ["with the body in a paragraph of its own", "> [!NOTE]\n>\n> body\n"],
  ])("reads the marker %s", (_name, markdown) => {
    const html = render(markdown);
    expect(callouts(html)).toHaveLength(1);
    expect(text(html)).toBe("Note body");
  });

  it.each([
    ["an unknown kind", "> [!FOO]\n> body\n", "[!FOO] body"],
    ["text after the marker on its line", "> [!NOTE] body\n", "[!NOTE] body"],
    ["a marker that is not the first line", "> body\n> [!NOTE]\n", "body [!NOTE]"],
    ["a marker outside a quote", "[!NOTE]\n\nbody\n", "[!NOTE] body"],
  ])("leaves %s as it was written", (_name, markdown, shown) => {
    const html = render(markdown);
    expect(callouts(html)).toEqual([]);
    expect(text(html)).toBe(shown);
  });

  it("is a callout with nothing in it when the marker is all there is", () => {
    const html = render("> [!TIP]\n");
    expect(callouts(html)).toHaveLength(1);
    expect(text(html)).toBe("Tip");
    expect(html).not.toMatch(/<p[^>]*>\s*<\/p>/);
  });

  it("keeps everything else the quote holds", () => {
    const html = render("> [!WARNING]\n> First.\n>\n> - one\n> - two\n>\n> ```\n> code\n> ```\n>\n> > quoted\n");
    expect(callouts(html)).toHaveLength(1);
    expect(html).toMatch(/<li>one<\/li>/);
    expect(html).toContain("<pre");
    // A quote inside a callout is still a quote.
    expect(html).toMatch(/<blockquote>[\s\S]*quoted[\s\S]*<\/blockquote>/);
  });

  it("is found inside a list item", () => {
    expect(callouts(render("- item\n\n  > [!NOTE]\n  > body\n"))).toHaveLength(1);
  });

  it("is a note to assistive technology, named by its title, with a glyph that is not read", () => {
    const html = render("> [!CAUTION]\n> body\n");
    const [{ open }] = callouts(html);
    expect(open).toContain('role="note"');
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"/);
    expect(html).not.toContain("node=");
  });

  it.each([
    ["note", "text-kh-text-muted"],
    ["tip", "text-kh-success"],
    ["important", "text-kh-text"],
    ["warning", "text-kh-warning"],
    ["caution", "text-kh-danger"],
  ])("colours only the glyph and the line of a %s, from the semantic tokens", (kind, colour) => {
    const html = render(`> [!${kind}]\n> body\n`);
    expect(html).toMatch(new RegExp(`<svg[^>]*class="[^"]*\\b${colour}(?![-\\w])`));
    // The title and the body are read in the text colour, not the quote's muted one.
    expect(callouts(html)[0].open).toMatch(/\btext-kh-text\b/);
  });

  it("is not drawn where the editor's look is stood in for: there it is the quote the editor shows", () => {
    const html = renderToStaticMarkup(<MarkdownBase markdown={"> [!NOTE]\n> body\n"} />);
    expect(callouts(html)).toEqual([]);
    expect(text(html)).toBe("[!NOTE] body");
  });
});

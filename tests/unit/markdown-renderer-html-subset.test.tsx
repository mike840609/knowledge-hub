import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { withoutReviewPaths } from "../fixtures/rendered-markdown";
import { MarkdownBase } from "@/components/knowledge/markdown-base";
import { MarkdownRenderer } from "@/components/knowledge/markdown-renderer";
import { extractOutline } from "@/shared/markdown/outline";

const render = (markdown: string) => withoutReviewPaths(renderToStaticMarkup(<MarkdownRenderer markdown={markdown} />));
/** The page without the wrapper and without the classes and whitespace that are not the point. */
const shape = (markdown: string) =>
  render(markdown)
    .replace(/^<div[^>]*>|<\/div>$/g, "")
    .replace(/ class="[^"]*"/g, "")
    .replace(/>\s+</g, "><")
    .trim();
const tags = (html: string) => new Set([...html.matchAll(/<([a-z][a-z0-9]*)/gi)].map((match) => match[1].toLowerCase()));

/**
 * The HTML the reader understands beyond `<br>` and comments
 * (docs/superpowers/specs/2026-10-12-reader-html-subset-design.md): seven tags, written bare. What
 * it does not recognise it shows as the text it was written as — it never lets markup through.
 */
describe("the HTML subset in the rendered document", () => {
  describe("inline tags", () => {
    it.each([["u"], ["sub"], ["sup"], ["kbd"], ["mark"]])("draws <%s> around what it holds", (tag) => {
      expect(shape(`a <${tag}>b</${tag}> c\n`)).toBe(`<p>a <${tag}>b</${tag}> c</p>`);
    });

    it.each([
      ["in upper case", "a <KBD>b</KBD> c\n", "<p>a <kbd>b</kbd> c</p>"],
      ["around Markdown", "<u>**b** and `c`</u>\n", "<p><u><strong>b</strong> and <code>c</code></u></p>"],
      ["nested", "H<sub>2<sup>x</sup></sub>O\n", "<p>H<sub>2<sup>x</sup></sub>O</p>"],
      ["twice in a line", "<kbd>Ctrl</kbd>+<kbd>S</kbd>\n", "<p><kbd>Ctrl</kbd>+<kbd>S</kbd></p>"],
      ["inside emphasis", "**a <mark>b</mark>**\n", "<p><strong>a <mark>b</mark></strong></p>"],
      ["in a list item", "- a <u>b</u>\n", "<ul><li>a <u>b</u></li></ul>"],
      ["in a heading", "## a <u>b</u>\n", '<h2 id="a-b">a <u>b</u></h2>'],
    ])("reads them %s", (_name, markdown, html) => {
      expect(shape(markdown)).toBe(html);
    });

    it("reads them in a table cell", () => {
      expect(shape("| a |\n| - |\n| x<sup>2</sup> |\n")).toContain("<td>x<sup>2</sup></td>");
    });

    it.each([
      ["a tag that is never closed", "a <u>b c\n", "<p>a &lt;u&gt;b c</p>"],
      ["a closing tag with nothing open", "a b</u> c\n", "<p>a b&lt;/u&gt; c</p>"],
      ["a tag closed by another's", "a <u>b</sub> c\n", "<p>a &lt;u&gt;b&lt;/sub&gt; c</p>"],
      ["a tag with an attribute", 'a <u class="x">b</u> c\n', "<p>a &lt;u class=&quot;x&quot;&gt;b&lt;/u&gt; c</p>"],
      ["a tag with a space in it", "a <u >b</u > c\n", "<p>a &lt;u &gt;b&lt;/u &gt; c</p>"],
      ["a self-closing tag", "a <u/> c\n", "<p>a &lt;u/&gt; c</p>"],
      ["a tag that opens in one paragraph and closes in the next", "a <u>b\n\nc</u> d\n", "<p>a &lt;u&gt;b</p><p>c&lt;/u&gt; d</p>"],
      ["a tag outside the subset", "a <span>b</span> <b>c</b>\n", "<p>a &lt;span&gt;b&lt;/span&gt; &lt;b&gt;c&lt;/b&gt;</p>"],
      ["angle brackets that were never HTML to the author", "List<String> and <your-token>\n", "<p>List&lt;String&gt; and &lt;your-token&gt;</p>"],
    ])("leaves %s as the text it was written as", (_name, markdown, html) => {
      expect(shape(markdown)).toBe(html);
    });

    it("keeps an inner tag that was not closed as text, inside the outer one that was", () => {
      expect(shape("<u>a <sub>b</u>\n")).toBe("<p><u>a &lt;sub&gt;b</u></p>");
    });

    it("is inline: around whole paragraphs it stays text", () => {
      const html = render("<u>\n\na\n\n</u>\n");
      expect(tags(html).has("u")).toBe(false);
      expect(html).toContain("&lt;u&gt;");
    });

    it("leaves them as text inside code", () => {
      expect(shape("`<u>a</u>`\n")).toBe("<p><code>&lt;u&gt;a&lt;/u&gt;</code></p>");
    });
  });

  describe("<details>", () => {
    const folded = (open: string, body = "Body **here**.") => `${open}\n\n${body}\n\n</details>\n`;

    it("is a disclosure: its summary, and its body as Markdown", () => {
      expect(shape(folded("<details>\n<summary>More</summary>"))).toBe("<details><summary>More</summary><div><p>Body <strong>here</strong>.</p></div></details>");
    });

    it.each([
      ["with the summary on the opening line", "<details><summary>More</summary>"],
      ["with the summary in a block of its own", "<details>\n\n<summary>More</summary>"],
      ["in upper case", "<DETAILS>\n<SUMMARY>More</SUMMARY>"],
      ["with space around the summary's text", "<details>\n<summary>  More  </summary>"],
    ])("reads the opening %s", (_name, open) => {
      expect(shape(folded(open))).toBe("<details><summary>More</summary><div><p>Body <strong>here</strong>.</p></div></details>");
    });

    it("starts open when written <details open>, and takes no other attribute", () => {
      expect(shape(folded("<details open>\n<summary>More</summary>"))).toMatch(/^<details open=""><summary>More<\/summary>/);
    });

    it("is given a summary when it has none, so it is drawn like the others and not as the browser's own", () => {
      expect(shape(folded("<details>"))).toBe("<details><summary>Details</summary><div><p>Body <strong>here</strong>.</p></div></details>");
      expect(shape(folded("<details>\n<summary></summary>"))).toBe("<details><summary>Details</summary><div><p>Body <strong>here</strong>.</p></div></details>");
    });

    it("holds whatever Markdown its body is, a callout and another <details> included", () => {
      const html = shape(folded("<details>\n<summary>Outer</summary>", "- one\n- two\n\n> [!NOTE]\n> note\n\n<details>\n<summary>Inner</summary>\n\ninner body\n\n</details>"));
      expect(html).toMatch(/^<details><summary>Outer<\/summary><div><ul><li>one<\/li><li>two<\/li><\/ul>/);
      expect(html).toContain('data-callout="note"');
      expect(html).toContain("<details><summary>Inner</summary><div><p>inner body</p></div></details></div></details>");
    });

    it("is found inside a list item", () => {
      expect(shape("- item\n\n  <details>\n  <summary>More</summary>\n\n  body\n\n  </details>\n")).toContain("<details><summary>More</summary><div><p>body</p></div></details>");
    });

    it("has a summary the keyboard can reach and see", () => {
      expect(render(folded("<details>\n<summary>More</summary>"))).toMatch(/<summary class="[^"]*\bkh-focus-ring\b/);
    });

    it.each([
      ["that is never closed", "<details>\n<summary>More</summary>\n\nbody\n"],
      ["with an attribute", '<details class="x">\n<summary>More</summary>\n\nbody\n\n</details>\n'],
      ["with an event handler", '<details ontoggle="alert(1)">\n<summary>More</summary>\n\nbody\n\n</details>\n'],
      ["whose summary holds a tag", "<details>\n<summary><b>More</b></summary>\n\nbody\n\n</details>\n"],
      ["whose summary has an attribute", '<details>\n<summary onclick="x()">More</summary>\n\nbody\n\n</details>\n'],
      ["written without blank lines, which Markdown reads as one piece of HTML", "<details>\n<summary>More</summary>\nbody\n</details>\n"],
    ])("leaves one %s as the text it was written as", (_name, markdown) => {
      const html = render(markdown);
      expect(tags(html).has("details")).toBe(false);
      expect(tags(html).has("summary")).toBe(false);
      expect(html).toContain("&lt;details");
    });

    it("leaves a closing tag with nothing open as text", () => {
      const html = render("a\n\n</details>\n");
      expect(tags(html).has("details")).toBe(false);
      expect(html).toContain("&lt;/details&gt;");
    });

    it("is a block: written inside a line of text it stays text", () => {
      const html = render("a <details> b </details> c\n");
      expect(tags(html).has("details")).toBe(false);
      expect(html).toContain("&lt;details&gt;");
    });
  });

  describe("lets no markup through", () => {
    // Elements the renderer itself makes from this Markdown: a paragraph, the subset, and nothing else.
    const allowed = new Set(["div", "p", "u", "sub", "sup", "kbd", "mark", "details", "summary", "br"]);
    it.each([
      ["<script>alert(1)</script>"],
      ["<img src=x onerror=alert(1)>"],
      ["<iframe src=\"https://example.com\"></iframe>"],
      ["<svg onload=alert(1)><circle /></svg>"],
      ["<a href=\"javascript:alert(1)\">x</a>"],
      ["<u onclick=\"alert(1)\">x</u>"],
      ["<u\nonclick=alert(1)>x</u>"],
      ["<u/onclick=alert(1)>x</u>"],
      ["<kbd style=\"position:fixed\">x</kbd>"],
      ["<mark><script>alert(1)</script></mark>"],
      ["<u><img src=x onerror=alert(1)></u>"],
      ["<details open ontoggle=alert(1)>\n<summary>x</summary>\n\nbody\n\n</details>"],
      ["<details open=\"\" id=x>\n\nbody\n\n</details>"],
      ["<details>\n<summary><img src=x onerror=alert(1)></summary>\n\nbody\n\n</details>"],
      ["<details>\n<summary>x</summary><script>alert(1)</script>\n\nbody\n\n</details>"],
      ["<DeTaIlS oNtOgGlE=alert(1) open>\n\nbody\n\n</DeTaIlS>"],
      ["<style>body{display:none}</style>"],
      ["<form action=\"https://example.com\"><input name=q></form>"],
      ["<base href=\"https://example.com/\">"],
      ["<u>x</u><!-- --><script>alert(1)</script>"],
    ])("%s", (markdown) => {
      const html = render(`${markdown}\n`);
      for (const tag of tags(html)) expect(allowed, `<${tag}> in ${html}`).toContain(tag);
      // The only attributes are the wrapper's and the elements' classes, and `open`.
      expect(html.replace(/ class="[^"]*"/g, "").replace(/<details open="">/g, "<details>")).not.toMatch(/<[a-z][a-z0-9]*\s[^>]*>/i);
    });
  });

  it("is not drawn where the editor's look is stood in for: there the tags are the text the editor shows", () => {
    const html = renderToStaticMarkup(<MarkdownBase markdown={"a <u>b</u>\n\n<details>\n\nbody\n\n</details>\n"} />);
    expect(tags(html).has("u")).toBe(false);
    expect(tags(html).has("details")).toBe(false);
    expect(html).toContain("&lt;u&gt;b&lt;/u&gt;");
  });

  it("keeps the tags out of the outline, and the page's ids the outline's", () => {
    const markdown = "## Press <kbd>Ctrl</kbd> twice\n\n## H<sub>2</sub>O\n";
    const outline = extractOutline(markdown);
    expect(outline.map((entry) => entry.text)).toEqual(["Press Ctrl twice", "H2O"]);
    const ids = [...render(markdown).matchAll(/<h2[^>]*\bid="([^"]*)"/g)].map((match) => match[1]);
    expect(ids).toEqual(outline.map((entry) => entry.slug));
  });
});

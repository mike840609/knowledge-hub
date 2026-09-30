import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { codeAsWritten } from "@/components/knowledge/copy-code-button";
import { MarkdownBase } from "@/components/knowledge/markdown-base";
import { MarkdownRenderer } from "@/components/knowledge/markdown-renderer";

const reader = (markdown: string) => renderToStaticMarkup(<MarkdownRenderer markdown={markdown} />);
const plain = (markdown: string) => renderToStaticMarkup(<MarkdownBase markdown={markdown} />);

const SQL = "```sql\nselect id from t where n = 1\n```";

describe("code in the reader's renderer", () => {
  it("is coloured, and each block has a button to copy it", () => {
    const html = reader(`${SQL}\n\ntext\n\n\`\`\`python\ndef f(): return 1\n\`\`\`\n`);
    expect(html).toContain('<span class="hljs-keyword">select</span>');
    expect(html).toContain('<span class="hljs-keyword">def</span>');
    expect(html.match(/aria-label="Copy code"/g)).toHaveLength(2);
    expect(html.match(/data-code-block/g)).toHaveLength(2);
  });

  it("puts a button on a block with no language too, and colours nothing in it", () => {
    for (const markdown of ["```\nselect 1\n```", "para\n\n    select 1\n"]) {
      const html = reader(markdown);
      expect(html).toContain('aria-label="Copy code"');
      expect(html).not.toContain("hljs");
    }
  });

  it("has no button on inline code", () => {
    expect(reader("run `select 1` first")).not.toContain("Copy code");
  });

  it("escapes what is in the code: a script in a block is text, not an element", () => {
    const html = reader('```html\n<script>alert("x")</script>\n<img src=x onerror=alert(1)>\n```\n\n```sql\nselect \'<script>\' from t\n```\n');
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<img/i);
    expect(html).toContain("&lt;");
    // The shown text is the code, entity for entity.
    expect(html).toContain("alert(");
  });

  it("does not turn raw HTML in the document into elements either", () => {
    const html = reader('before <script>alert(1)</script> after\n\n<div onclick="x()">raw</div>\n');
    expect(html).not.toMatch(/<script/i);
    // Shown as the text it is: an `onclick` may appear in the words, never as an attribute of an element.
    expect(html).not.toMatch(/<[a-z][^>]*\sonclick=/i);
    expect(html).toContain("&lt;div onclick=");
  });

  it("puts the copy button outside the <pre>, so what is copied is only the code", () => {
    const html = reader(SQL);
    const pre = /<pre[ >][\s\S]*<\/pre>/.exec(html)![0];
    expect(pre).not.toContain("Copy code");
    expect(pre).not.toContain("<button");
  });
});

describe("the plain renderer, which the composer shows while its editor loads", () => {
  it("draws the same box with no colour and no button", () => {
    const html = plain(SQL);
    expect(html).toContain("data-code-block");
    expect(html).toContain("<pre");
    expect(html).not.toContain("hljs");
    expect(html).not.toContain("Copy code");
    expect(html).not.toContain("<button");
  });
});

describe("codeAsWritten", () => {
  it("drops the one newline Markdown puts after code, and only that", () => {
    expect(codeAsWritten("select 1\n")).toBe("select 1");
    expect(codeAsWritten("select 1\n\n")).toBe("select 1\n");
    expect(codeAsWritten("no newline")).toBe("no newline");
    expect(codeAsWritten("")).toBe("");
    expect(codeAsWritten("\n")).toBe("");
  });
});

describe("no path from Markdown to the page other than elements", () => {
  it.each(["markdown-base.tsx", "markdown-renderer.tsx", "markdown-article.tsx", "copy-code-button.tsx", "code-highlight.ts"])("%s does not use dangerouslySetInnerHTML", (file) => {
    expect(readFileSync(new URL(`../../src/components/knowledge/${file}`, import.meta.url), "utf8")).not.toContain("dangerouslySetInnerHTML");
  });
});

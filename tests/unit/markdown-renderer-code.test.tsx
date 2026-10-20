import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { COLLAPSE_OVER_LINES } from "@/components/knowledge/code-block";
import { lineCount } from "@/components/knowledge/code-highlight";
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

  it("keeps the button off the printed page", () => {
    expect(reader(SQL)).toMatch(/<div class="[^"]*\bprint:hidden\b[^"]*">(<span[^>]*>sql<\/span>)?<span aria-live="polite"/);
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

describe("the language a block names, shown in its corner", () => {
  const label = (html: string) => /<span title="([^"]*)" class="[^"]*\btruncate\b[^"]*">([^<]*)<\/span>/.exec(html);

  it("is the fence's word as written, outside the <pre>", () => {
    const html = reader("```ts\nconst a = 1\n```");
    expect(label(html)?.slice(1)).toEqual(["ts", "ts"]);
    expect(/<pre[ >][\s\S]*<\/pre>/.exec(html)![0]).not.toContain('title="ts"');
  });

  it("is shown for a language the reader cannot colour, which is left plain", () => {
    const html = reader("```toml-but-not\nkey = 1\n```");
    expect(label(html)?.[2]).toBe("toml-but-not");
    expect(html).not.toContain("hljs");
  });

  it("is absent when nothing is named: a bare fence, or indented code", () => {
    for (const markdown of ["```\nselect 1\n```", "para\n\n    select 1\n"]) expect(label(reader(markdown))).toBeNull();
  });

  it("is text, never markup", () => {
    const html = reader('```"><img/src=x>\nx\n```');
    expect(html).not.toMatch(/<img/i);
  });
});

describe("a long block", () => {
  const block = (n: number) => `\`\`\`sql\n${Array.from({ length: n }, (_, i) => `select ${i};`).join("\n")}\n\`\`\``;
  const toggle = (html: string) => /<button[^>]*aria-expanded="false"[^>]*>Show all (\d+) lines<\/button>/.exec(html);

  it(`opens collapsed over ${COLLAPSE_OVER_LINES} lines, scrolling inside a held height that print releases`, () => {
    const html = reader(block(COLLAPSE_OVER_LINES + 1));
    expect(toggle(html)?.[1]).toBe(String(COLLAPSE_OVER_LINES + 1));
    const scroller = /<div id="([^"]+)" class="([^"]*)"><pre/.exec(html)!;
    expect(scroller[2]).toMatch(/\bmax-h-\[31\.5rem\]/);
    expect(scroller[2]).toMatch(/\boverflow-y-auto\b/);
    expect(scroller[2]).toMatch(/\bprint:max-h-none\b/);
    expect(html).toContain(`aria-controls="${scroller[1]}"`);
    // Every line is still in the page: held, not cut.
    expect(html).toContain(`<span class="hljs-number">${COLLAPSE_OVER_LINES}</span>;`);
  });

  it(`is whole, with no toggle, at ${COLLAPSE_OVER_LINES} lines`, () => {
    const html = reader(block(COLLAPSE_OVER_LINES));
    expect(html).not.toContain("Show all");
    expect(html).not.toContain("max-h-");
  });

  it("keeps the toggle off the printed page and out of what is copied", () => {
    const html = reader(block(40));
    expect(html).toMatch(/<div class="[^"]*\bprint:hidden\b[^"]*"><button[^>]*aria-expanded/);
    expect(/<pre[ >][\s\S]*<\/pre>/.exec(html)![0]).not.toContain("Show all");
  });

  it("is counted without the newline Markdown adds, so 31 written lines are 31", () => {
    expect(reader(block(31))).toContain('data-lines="31"');
  });
});

describe("lineCount", () => {
  it("counts lines as the copy button copies them", () => {
    expect(lineCount("")).toBe(0);
    expect(lineCount("\n")).toBe(0);
    expect(lineCount("a\n")).toBe(1);
    expect(lineCount("a")).toBe(1);
    expect(lineCount("a\nb\n")).toBe(2);
    expect(lineCount("a\n\n")).toBe(2);
  });
});

describe("the plain renderer, which the composer shows while its editor loads", () => {
  it("has no fold and no language label, however long the block", () => {
    const html = plain(`\`\`\`sql\n${"select 1;\n".repeat(60)}\`\`\``);
    expect(html).not.toContain("Show all");
    expect(html).not.toContain("max-h-");
    expect(html).not.toContain("data-lines");
    expect(html).not.toContain('title="sql"');
  });

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
  it.each(["markdown-base.tsx", "markdown-renderer.tsx", "markdown-article.tsx", "copy-code-button.tsx", "code-highlight.ts", "code-block.tsx", "scrollable-pre.tsx"])("%s does not use dangerouslySetInnerHTML", (file) => {
    expect(readFileSync(new URL(`../../src/components/knowledge/${file}`, import.meta.url), "utf8")).not.toContain("dangerouslySetInnerHTML");
  });
});

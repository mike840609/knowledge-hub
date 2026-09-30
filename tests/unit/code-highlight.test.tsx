import { common } from "lowlight";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import { describe, expect, it } from "vitest";
import { codeHighlightPlugins, HIGHLIGHT_LANGUAGES, MAX_HIGHLIGHT_CHARS, MAX_HIGHLIGHT_DEPTH, MAX_HIGHLIGHT_DOCUMENT_CHARS, rehypeCodeHighlight, type CodeHighlightOptions } from "@/components/knowledge/code-highlight";
import { PLATFORM_SAMPLES } from "../fixtures/code-samples";

/** The Markdown through the same plugins the renderer uses, as HTML. */
function render(markdown: string): string {
  return renderToStaticMarkup(<ReactMarkdown rehypePlugins={codeHighlightPlugins}>{markdown}</ReactMarkdown>);
}

const fence = (language: string, code: string) => "```" + language + "\n" + code + "\n```";

/** The same, with the plugin given other limits or languages. */
function renderWith(options: CodeHighlightOptions, markdown: string): string {
  return renderToStaticMarkup(<ReactMarkdown rehypePlugins={[[rehypeCodeHighlight, options]]}>{markdown}</ReactMarkdown>);
}
/** For each code block of the output, in order: is it coloured? */
const colouredBlocks = (html: string) => [...html.matchAll(/<code[^>]*>([\s\S]*?)<\/code>/g)].map((match) => /<span class="hljs-/.test(match[1]));

/** What the `<code>` element holds, as HTML. */
function codeHtml(markdown: string): string {
  const match = /<code[^>]*>([\s\S]*?)<\/code>/.exec(render(markdown));
  if (!match) throw new Error("no <code> in the output");
  return match[1];
}

const ENTITIES: Record<string, string> = { "&lt;": "<", "&gt;": ">", "&amp;": "&", "&quot;": '"', "&#x27;": "'" };

/** What a reader sees of it: the tags gone, the entities read. */
function shownText(html: string): string {
  return html.replace(/<[^>]*>/g, "").replace(/&(?:lt|gt|amp|quot|#x27);/g, (entity) => ENTITIES[entity]);
}

const hasToken = (html: string) => /<span class="hljs-/.test(html);

describe("the languages", () => {
  it("are lowlight's common set and three more, and nothing else", () => {
    // Pinned so that taking `all` (192 grammars in the bundle) or dropping one of the three is a decision, not an accident.
    expect(Object.keys(HIGHLIGHT_LANGUAGES).sort()).toEqual([...Object.keys(common), "dockerfile", "groovy", "protobuf"].sort());
  });
});

describe("a fenced block with a language", () => {
  // The platform's own languages, one short example each, and classes the grammar must produce for it.
  it.each(PLATFORM_SAMPLES.map((sample) => [sample.language, sample.code, sample.classes] as const))("%s is coloured", (language, code, classes) => {
    const html = codeHtml(fence(language, code));
    for (const name of classes) expect(html).toContain(`class="${name}`);
  });

  it.each([
    ["yml", "a: 1"],
    ["sh", "ls -la"],
    ["docker", "FROM x"],
    ["proto", 'syntax = "proto3";'],
    ["js", "const a = 1"],
    ["ts", "const a: number = 1"],
    ["py", "def f(): pass"],
  ])("takes the alias %s", (alias, code) => {
    expect(hasToken(codeHtml(fence(alias, code)))).toBe(true);
  });

  it("keeps the code exactly as written under the colour, and escapes what HTML would take for markup", () => {
    const code = `<script>alert("x & y")</script>\nselect '<b>' from t where a < 1 and b > 2`;
    for (const language of ["xml", "sql", "bash"]) {
      const html = codeHtml(fence(language, code));
      expect(shownText(html)).toBe(code + "\n");
      expect(html).not.toContain("<script");
      expect(html).not.toContain("<b>");
    }
  });

  it("leaves a language it does not have as plain text, without failing the page", () => {
    // `properties` is a highlight.js language that is not in `common`; `mermaid` is not one at all.
    for (const language of ["properties", "mermaid", "notalanguage"]) {
      const html = codeHtml(fence(language, "a.b=1 <c>"));
      expect(hasToken(html)).toBe(false);
      expect(shownText(html)).toBe("a.b=1 <c>\n");
    }
    expect(render(fence("mermaid", "graph TD; A-->B"))).not.toContain("hljs");
  });

  it("leaves a block that says no-highlight alone, in whatever language it also names", () => {
    const tree = (
      <ReactMarkdown
        rehypePlugins={[
          () => (root: { children: { children?: { tagName?: string; properties?: { className?: string[] } }[] }[] }) => {
            // As a plugin before this one would mark it (the class Markdown gives is `language-sql`; this adds the mark).
            const code = root.children[0].children![0];
            code.properties!.className = ["language-sql", "no-highlight"];
          },
          rehypeCodeHighlight,
        ]}
      >
        {fence("sql", "select 1")}
      </ReactMarkdown>
    );
    expect(hasToken(renderToStaticMarkup(tree))).toBe(false);
  });
});

describe("a fenced block with no language", () => {
  it("is not coloured, and is not guessed at", () => {
    // Plainly SQL, and highlight.js would say so — which is why it is not asked.
    const html = codeHtml(fence("", "select id from t where n = 1"));
    expect(hasToken(html)).toBe(false);
    expect(render(fence("", "select 1"))).not.toContain("hljs");
  });

  it("is not coloured when indented rather than fenced", () => {
    expect(render("para\n\n    select id from t\n")).not.toContain("hljs");
  });

  it("leaves inline code alone, whatever it says", () => {
    expect(render("run `select id from t` first")).not.toContain("hljs");
  });
});

describe("a block over the limit", () => {
  /** A block of SQL whose text, with the newline Markdown puts after it, is `length` characters. */
  const sqlOfLength = (length: number) => {
    const line = "select 1;\n";
    const body = line.repeat(Math.ceil(length / line.length)).slice(0, length - 1);
    return body.replace(/\n$/, ";");
  };

  it("is coloured at the limit and not one character past it", () => {
    const atLimit = codeHtml(fence("sql", sqlOfLength(MAX_HIGHLIGHT_CHARS)));
    expect(shownText(atLimit).length).toBe(MAX_HIGHLIGHT_CHARS);
    expect(hasToken(atLimit)).toBe(true);

    const over = codeHtml(fence("sql", sqlOfLength(MAX_HIGHLIGHT_CHARS + 1)));
    expect(shownText(over).length).toBe(MAX_HIGHLIGHT_CHARS + 1);
    expect(hasToken(over)).toBe(false);
  });

  it("is still all there: the text is the code as written", () => {
    const code = sqlOfLength(MAX_HIGHLIGHT_CHARS * 3);
    expect(shownText(codeHtml(fence("sql", code)))).toBe(code + "\n");
  });

  it("does not make the blocks after it plain", () => {
    const html = render([fence("sql", sqlOfLength(MAX_HIGHLIGHT_CHARS + 1)), "", fence("sql", "select 1")].join("\n"));
    const blocks = [...html.matchAll(/<code[^>]*>([\s\S]*?)<\/code>/g)].map((match) => hasToken(match[1]));
    expect(blocks).toEqual([false, true]);
  });
});

describe("a document over its budget", () => {
  /** A block whose text, with the newline Markdown adds, is `length` characters of SQL. */
  const sqlBlock = (length: number) => fence("sql", "select 1;".repeat(Math.ceil(length / 9)).slice(0, length - 1));

  it("leaves room for at least one block at the block limit", () => {
    expect(MAX_HIGHLIGHT_DOCUMENT_CHARS).toBeGreaterThan(MAX_HIGHLIGHT_CHARS);
  });

  it("colours blocks in order until the budget is spent, then leaves the rest plain", () => {
    const html = renderWith({ maxDocumentChars: 250 }, [sqlBlock(100), sqlBlock(100), sqlBlock(100), sqlBlock(100)].join("\n\n"));
    expect(colouredBlocks(html)).toEqual([true, true, false, false]);
  });

  it("judges each block on its own: a small one after the budget ran short still fits in what is left", () => {
    const html = renderWith({ maxDocumentChars: 250 }, [sqlBlock(100), sqlBlock(100), sqlBlock(100), sqlBlock(50)].join("\n\n"));
    expect(colouredBlocks(html)).toEqual([true, true, false, true]);
  });

  it("holds at the real limits: 20 blocks of 5,000 characters are coloured and the 21st is not", () => {
    const html = render(Array.from({ length: 21 }, () => sqlBlock(5_000)).join("\n\n"));
    const blocks = colouredBlocks(html);
    expect(blocks.slice(0, 20).every(Boolean)).toBe(true);
    expect(blocks[20]).toBe(false);
  });

  it("counts a block that was tried and then refused for its depth as spent", () => {
    // 100 characters of Rust whose comments nest two deep, against a depth limit of one; then two plain blocks.
    const nested = fence("rust", "/* /* " + "x".repeat(87) + " */ */");
    const html = renderWith({ maxDocumentChars: 250, maxDepth: 1 }, [nested, sqlBlock(100), sqlBlock(100)].join("\n\n"));
    expect(colouredBlocks(html)).toEqual([false, true, false]);
  });
});

describe("a block nested too deeply", () => {
  const nested = (levels: number) => "/* ".repeat(levels) + "x" + " */".repeat(levels);

  // Rust's and Swift's comments nest, so `/*` repeated makes as many levels of <span>, and rendering that many overflows the stack.
  it.each(["rust", "swift"])("in %s is left as plain text and the page still renders", (language) => {
    const code = "/*".repeat(MAX_HIGHLIGHT_CHARS / 2 - 1);
    let html = "";
    expect(() => (html = codeHtml(fence(language, code)))).not.toThrow();
    expect(hasToken(html)).toBe(false);
    expect(shownText(html)).toBe(code + "\n");
  });

  it("still colours what real code does: comments nested a few levels", () => {
    expect(hasToken(codeHtml(fence("rust", "/* a /* b */ c */ fn main() {}")))).toBe(true);
    expect(hasToken(codeHtml(fence("rust", nested(5))))).toBe(true);
  });

  it("is judged by the limit: at it, coloured; one level past it, not", () => {
    expect(hasToken(renderWith({ maxDepth: 3 }, fence("rust", nested(3))))).toBe(true);
    expect(hasToken(renderWith({ maxDepth: 3 }, fence("rust", nested(4))))).toBe(false);
  });

  it("has a default limit far below where rendering fails, and above where real code goes", () => {
    expect(MAX_HIGHLIGHT_DEPTH).toBeGreaterThanOrEqual(20);
    expect(MAX_HIGHLIGHT_DEPTH).toBeLessThanOrEqual(200);
  });
});

describe("a grammar that fails", () => {
  // Registers without complaint and throws when it is first used: an invalid regular expression is compiled then.
  const broken = () => ({ contains: [{ begin: "(" }] });

  it("leaves its block as plain text, and does not stop the blocks after it", () => {
    const html = renderWith({ languages: { ...common, broken } }, [fence("broken", "a ( <b>"), fence("sql", "select 1")].join("\n\n"));
    expect(colouredBlocks(html)).toEqual([false, true]);
    expect(html).toContain("a ( &lt;b&gt;");
  });
});

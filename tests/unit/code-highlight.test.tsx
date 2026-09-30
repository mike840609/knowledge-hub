import { common } from "lowlight";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import { describe, expect, it } from "vitest";
import { codeHighlightPlugins, HIGHLIGHT_LANGUAGES, MAX_HIGHLIGHT_CHARS } from "@/components/knowledge/code-highlight";

/** The Markdown through the same plugins the renderer uses, as HTML. */
function render(markdown: string): string {
  return renderToStaticMarkup(<ReactMarkdown rehypePlugins={codeHighlightPlugins}>{markdown}</ReactMarkdown>);
}

const fence = (language: string, code: string) => "```" + language + "\n" + code + "\n```";

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
  // The platform's own languages, one line of each, and a class the grammar must produce for it.
  it.each([
    ["sql", "select id from t where n = 1 -- note", ["hljs-keyword", "hljs-number", "hljs-comment"]],
    ["yaml", "name: x\nlist:\n  - 1", ["hljs-attr", "hljs-number"]],
    ["java", "public class A { int x = 1; }", ["hljs-keyword", "hljs-type", "hljs-number"]],
    ["python", "def f():\n  return 1", ["hljs-keyword", "hljs-number"]],
    ["bash", 'echo "a" | grep b', ["hljs-built_in", "hljs-string"]],
    ["json", '{"a": 1, "b": [true]}', ["hljs-attr", "hljs-number", "hljs-literal"]],
    ["xml", '<a b="1"/>', ["hljs-tag", "hljs-name", "hljs-attr", "hljs-string"]],
    ["kotlin", "fun main() { val x = 1 }", ["hljs-keyword", "hljs-number"]],
    ["dockerfile", "FROM node:22\nRUN npm ci", ["hljs-keyword", "hljs-number"]],
    ["groovy", "def x = 1", ["hljs-keyword", "hljs-number"]],
    ["protobuf", "message A { string b = 1; }", ["hljs-keyword", "hljs-type", "hljs-number"]],
  ])("%s is coloured", (language, code, classes) => {
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

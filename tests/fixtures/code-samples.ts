/**
 * A little code in each language the platform's own documents are written in, and the classes
 * highlight.js must give it. Read by the highlight tests (does it colour these) and by the colour
 * tests (does every class it emits have a colour, or a reason not to).
 */
export type CodeSample = { language: string; code: string; classes: string[] };

/** The languages of the stack, one short example each. */
export const PLATFORM_SAMPLES: CodeSample[] = [
  { language: "sql", code: "select id from t where n = 1 -- note", classes: ["hljs-keyword", "hljs-number", "hljs-comment"] },
  { language: "yaml", code: "name: x\nlist:\n  - 1", classes: ["hljs-attr", "hljs-number"] },
  { language: "java", code: "public class A { int x = 1; }", classes: ["hljs-keyword", "hljs-type", "hljs-number"] },
  { language: "python", code: "def f():\n  return 1", classes: ["hljs-keyword", "hljs-number"] },
  { language: "bash", code: 'echo "a" | grep b', classes: ["hljs-built_in", "hljs-string"] },
  { language: "json", code: '{"a": 1, "b": [true]}', classes: ["hljs-attr", "hljs-number", "hljs-literal"] },
  { language: "xml", code: '<a b="1"/>', classes: ["hljs-tag", "hljs-name", "hljs-attr", "hljs-string"] },
  { language: "kotlin", code: "fun main() { val x = 1 }", classes: ["hljs-keyword", "hljs-number"] },
  { language: "dockerfile", code: "FROM node:22\nRUN npm ci", classes: ["hljs-keyword", "hljs-number"] },
  { language: "groovy", code: "def x = 1", classes: ["hljs-keyword", "hljs-number"] },
  { language: "protobuf", code: "message A { string b = 1; }", classes: ["hljs-keyword", "hljs-type", "hljs-number"] },
];

/** Constructs the samples above do not reach: each one is there for a class highlight.js emits and the others do not. */
export const SCOPE_SAMPLES: CodeSample[] = [
  { language: "diff", code: "--- a\n+++ b\n@@ -1 +1 @@\n-old\n+new", classes: ["hljs-addition", "hljs-deletion", "hljs-meta"] },
  { language: "css", code: ".a > b:hover, #i[x=1] { color: #fff; margin: 0 }", classes: ["hljs-selector-class", "hljs-selector-tag", "hljs-selector-pseudo", "hljs-selector-id", "hljs-selector-attr", "hljs-attribute"] },
  { language: "markdown", code: "# Title\n- item\n*em* **strong** `code`\n> quote\n[l](u)", classes: ["hljs-section", "hljs-bullet", "hljs-emphasis", "hljs-strong", "hljs-code", "hljs-quote", "hljs-link"] },
  { language: "javascript", code: "const re = /a+/g; // c\nconst t = `t ${x}`; class A extends B {}; this.f()", classes: ["hljs-regexp", "hljs-subst", "hljs-title", "hljs-variable"] },
  { language: "java", code: "@Override\npublic void f(String s) { return; }", classes: ["hljs-meta", "hljs-params", "hljs-title"] },
  { language: "kotlin", code: "class A : B() { fun f(): Int = 1 }", classes: ["hljs-function", "hljs-title", "hljs-type"] },
];

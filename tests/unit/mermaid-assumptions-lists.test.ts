import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DRAWN_TYPES } from "@/components/knowledge/mermaid-queue";

// scripts/test/mermaid-assumptions.mjs is the evidence, from a browser, for three lists in mermaid-queue.ts,
// and holds a copy of each. A list changed in one file only is a list nobody checked: read both as text.
const queue = readFileSync(path.join(process.cwd(), "src/components/knowledge/mermaid-queue.ts"), "utf8");
const script = readFileSync(path.join(process.cwd(), "scripts/test/mermaid-assumptions.mjs"), "utf8");

/** The one `NAME = …;` in `source`, as written after the `=`. */
function written(source: string, name: string): string {
  const found = Array.from(source.matchAll(new RegExp(`\\b${name} = (.+);`, "g")));
  expect(found, `${name} is written once`).toHaveLength(1);
  return found[0][1];
}
const strings = (list: string): string[] => JSON.parse(list) as string[];

describe("the lists mermaid-queue.ts and the assumptions script both hold", () => {
  it("the keys a diagram's own text may not set are the same in both", () => {
    expect(strings(written(queue, "SECURE"))).toEqual(strings(written(script, "SECURE")));
  });

  it("no key has left that list: Mermaid's six, html labels, the sanitiser, and the style, font, theme and layout", () => {
    expect(strings(written(queue, "SECURE"))).toEqual(expect.arrayContaining([
      "secure", "securityLevel", "startOnLoad", "maxTextSize", "suppressErrorRendering", "maxEdges",
      "htmlLabels", "dompurifyConfig",
      "themeCSS", "fontFamily", "altFontFamily", "theme", "themeVariables", "layout",
    ]));
  });

  it("the types that are drawn are the same in both, and are the ones the queue uses", () => {
    expect(strings(written(queue, "DRAWN_TYPES"))).toEqual(strings(written(script, "DRAWN_TYPES")));
    expect(strings(written(queue, "DRAWN_TYPES"))).toEqual(DRAWN_TYPES);
  });

  it("the sanitiser's configuration is the same in both, and leaves a line break and no attribute", () => {
    expect(written(queue, "SANITIZER")).toBe(written(script, "SANITIZER"));
    expect(written(queue, "SANITIZER")).toBe('{ ALLOWED_TAGS: ["br"], ALLOWED_ATTR: [] }');
  });
});

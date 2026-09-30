import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The composer is a client component, so everything it imports is sent to the browser — including
 * on the pages people open to write, where the reader's code colouring and copy buttons are of no
 * use. Its stand-in while the editor loads is `MarkdownBase`, which has neither; this holds the
 * rule that nothing on the composer's side reaches for the reader's renderer or the highlighter.
 * It reads the imports, so it fails when the import is added rather than when someone measures.
 */
const IMPORT = /(?:^|\n)\s*(?:import|export)\s+(?!type\b)[^;]*?\sfrom\s+["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)|(?:^|\n)\s*import\s+["']([^"']+)["']/g;

function resolve(specifier: string, from: string): string | null {
  const base = specifier.startsWith("@/") ? path.join("src", specifier.slice(2)) : specifier.startsWith(".") ? path.join(path.dirname(from), specifier) : null;
  if (base === null) return null;
  for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx"), base]) {
    if (existsSync(candidate) && /\.tsx?$/.test(candidate)) return candidate;
  }
  return null;
}

/** Every source file reachable from `entry` through imports that are not type-only, and every package name they name. */
function reachable(entry: string): { files: Set<string>; packages: Set<string> } {
  const files = new Set<string>();
  const packages = new Set<string>();
  const pending = [entry];
  while (pending.length > 0) {
    const file = pending.pop()!;
    if (files.has(file)) continue;
    files.add(file);
    for (const match of readFileSync(file, "utf8").matchAll(IMPORT)) {
      const specifier = match[1] ?? match[2] ?? match[3];
      const next = resolve(specifier, file);
      if (next) pending.push(next);
      else if (!specifier.startsWith(".") && !specifier.startsWith("@/")) packages.add(specifier);
    }
  }
  return { files, packages };
}

describe("what the composer sends to the browser", () => {
  const { files, packages } = reachable(path.join("src", "components", "knowledge", "document-composer.tsx"));
  const names = [...files].map((file) => path.basename(file));

  it("is really being read: it reaches the composer's own renderer and its Markdown library", () => {
    // Without this, a resolver that walked nothing would pass the checks below.
    expect(names).toContain("markdown-base.tsx");
    expect(names).toContain("markdown-article.tsx");
    expect(packages.has("react-markdown")).toBe(true);
    expect(files.size).toBeGreaterThan(20);
  });

  it("does not reach the reader's renderer, the highlighter or the copy button", () => {
    for (const forbidden of ["markdown-renderer.tsx", "code-highlight.ts", "copy-code-button.tsx"]) {
      expect(names, forbidden).not.toContain(forbidden);
    }
  });

  it("does not reach lowlight or highlight.js", () => {
    expect([...packages].filter((name) => /^(lowlight|highlight\.js)(\/|$)/.test(name))).toEqual([]);
  });
});

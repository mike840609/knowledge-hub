import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The composer is a client component, so everything it imports is sent to the browser — including
 * on the pages people open to write, where the reader's Markdown stack is of no use. Its stand-in
 * while the editor loads arrives as a server-rendered prop from the page (`standIn`), so the client
 * graph must not reach the reader's renderer, the Markdown stack, the highlighter or the copy
 * button. It reads the imports, so it fails when the import is added rather than when someone
 * measures. (`authored-title` still parses one line with mdast for the H1 rule — that is the only
 * Markdown parsing the composer ships, and it is small.)
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
function reachable(entry: string, followDynamic = true): { files: Set<string>; packages: Set<string> } {
  const files = new Set<string>();
  const packages = new Set<string>();
  const pending = [entry];
  while (pending.length > 0) {
    const file = pending.pop()!;
    if (files.has(file)) continue;
    files.add(file);
    for (const match of readFileSync(file, "utf8").matchAll(IMPORT)) {
      // match[2] is `import()`: the editor chunk, loaded on demand. First-load
      // assertions walk static imports only; the full walk covers both.
      if (match[2] && !followDynamic) continue;
      const specifier = match[1] ?? match[2] ?? match[3];
      const next = resolve(specifier, file);
      if (next) pending.push(next);
      else if (!specifier.startsWith(".") && !specifier.startsWith("@/")) packages.add(specifier);
    }
  }
  return { files, packages };
}

describe("what the composer sends to the browser", () => {
  // The full walk follows `import()` into the on-demand editor chunk: the reader's renderer, the
  // highlighter and the copy button must be in neither. The Markdown stack must not even be in the
  // static first-load walk — the stand-in arrives as a server-rendered prop.
  const full = reachable(path.join("src", "components", "knowledge", "document-composer.tsx"));
  const firstLoad = reachable(path.join("src", "components", "knowledge", "document-composer.tsx"), false);
  const names = [...firstLoad.files].map((file) => path.basename(file));

  it("is really being read: both walks reach the composer's own files", () => {
    // Without this, a resolver that walked nothing would pass the checks below.
    expect(names).toContain("authored-title.ts");
    expect(names).toContain("persistent-draft.ts");
    expect(firstLoad.files.size).toBeGreaterThan(10);
    expect([...full.files].map((file) => path.basename(file))).toContain("editor-core.ts");
  });

  it("sends no Markdown stack in the first load", () => {
    for (const forbidden of ["markdown-renderer.tsx", "markdown-article.tsx", "markdown-base.tsx"]) {
      expect(names, forbidden).not.toContain(forbidden);
    }
    for (const forbidden of ["react-markdown", "remark-gfm"]) {
      expect([...firstLoad.packages], forbidden).not.toContain(forbidden);
    }
  });

  it("does not reach the reader's renderer, the highlighter or the copy button at all", () => {
    const allNames = [...full.files].map((file) => path.basename(file));
    for (const forbidden of ["markdown-renderer.tsx", "code-highlight.ts", "copy-code-button.tsx"]) {
      expect(allNames, forbidden).not.toContain(forbidden);
    }
  });

  it("does not reach lowlight or highlight.js", () => {
    expect([...full.packages].filter((name) => /^(lowlight|highlight\.js)(\/|$)/.test(name))).toEqual([]);
  });
});

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { parseGenericMarkdownText } from "@/modules/sources/adapters/generic-markdown-folder-adapter";
import { DEFAULT_IMPORT_LIMITS } from "@/modules/sources/domain/import-limits";
import { extractDocumentLinks, type ExtractedLink } from "@/modules/knowledge/domain/document-links";
import { buildLinkResolver, normalizeLinkKey, type CatalogDocument } from "@/modules/knowledge/domain/link-resolution";
import { collectHeadings } from "@/shared/markdown/outline";
import { parseMarkdown } from "@/shared/markdown/parse";

/**
 * Guards for public/sample-wiki. Everything that decides "what is a title, a
 * link, a resolved link" is the project's own code, run on the files the way
 * the importer sees them (parseGenericMarkdownText on the raw text, the path
 * relative to the picked root).
 */
const SAMPLE_DIR = join(process.cwd(), "public", "sample-wiki");
const SOURCE_ID = "sample-source";
const MAX_SAMPLE_FILE_BYTES = 8 * 1024;
const CJK = /\p{Script=Han}/u;

type Manifest = { locales: Record<string, { label: string; sourceName: string; root: string; files: string[] }> };

const manifest = JSON.parse(readFileSync(join(SAMPLE_DIR, "manifest.json"), "utf8")) as Manifest;
const locales = Object.keys(manifest.locales);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

function diskFiles(locale: string): string[] {
  const root = join(SAMPLE_DIR, locale);
  return walk(root)
    .map((file) => relative(root, file).split("\\").join("/"))
    .sort();
}

function readText(locale: string, path: string): string {
  return readFileSync(join(SAMPLE_DIR, locale, path), "utf8");
}

function importLocale(locale: string) {
  return manifest.locales[locale].files.map((path) => {
    const text = readText(locale, path);
    const entry = parseGenericMarkdownText({ sourcePath: path, text, sourceFileHash: "-" });
    const catalogEntry: CatalogDocument = {
      documentId: `doc:${path}`,
      sourceId: SOURCE_ID,
      title: entry.resolvedTitle,
      sourcePath: path,
      createdAt: new Date(Date.UTC(2026, 0, 1)),
    };
    return { path, text, entry, catalogEntry, links: extractDocumentLinks(entry.markdown) };
  });
}

describe("sample wiki manifest", () => {
  it("is declared for en and zh-TW", () => {
    expect(locales.sort()).toEqual(["en", "zh-TW"]);
  });

  it.each(locales)("%s: lists exactly the files that exist on disk", (locale) => {
    expect([...manifest.locales[locale].files].sort()).toEqual(diskFiles(locale));
  });

  it("gives both locales the same seven relative paths", () => {
    const [en, zh] = [manifest.locales.en.files, manifest.locales["zh-TW"].files].map((files) => [...files].sort());
    expect(en).toHaveLength(7);
    expect(zh).toEqual(en);
  });

  it.each(locales)("%s: has a source name and a root folder name", (locale) => {
    const { sourceName, root, label } = manifest.locales[locale];
    expect(sourceName.trim()).not.toBe("");
    expect(label.trim()).not.toBe("");
    expect(root).toMatch(/^[A-Za-z0-9._-]+$/);
  });
});

describe("sample wiki files", () => {
  it.each(locales)("%s: only markdown, no .git or .obsidian, and small", (locale) => {
    for (const path of manifest.locales[locale].files) {
      const segments = path.split("/");
      expect(segments).not.toContain(".git");
      expect(segments).not.toContain(".obsidian");
      expect(path.endsWith(".md")).toBe(true);
      const bytes = statSync(join(SAMPLE_DIR, locale, path)).size;
      expect(bytes).toBeLessThan(DEFAULT_IMPORT_LIMITS.maxMarkdownFileBytes);
      expect(bytes).toBeLessThan(MAX_SAMPLE_FILE_BYTES);
    }
  });
});

describe("sample wiki titles and diagnostics", () => {
  it.each(locales)("%s: exactly one diagnostic, a TITLE_CONFLICT on handbook/title-mismatch.md", (locale) => {
    const diagnostics = importLocale(locale).flatMap(({ entry }) => entry.diagnostics);
    expect(diagnostics.map(({ code, sourcePath }) => ({ code, sourcePath }))).toEqual([
      { code: "TITLE_CONFLICT", sourcePath: "handbook/title-mismatch.md" },
    ]);
  });

  it.each(locales)("%s: index.md takes its title from frontmatter and another file from the first H1", (locale) => {
    const docs = importLocale(locale);
    expect(docs.find(({ path }) => path === "index.md")?.entry.titleSource).toBe("FRONTMATTER");
    expect(docs.some(({ entry }) => entry.titleSource === "H1")).toBe(true);
  });
});

describe("sample wiki links", () => {
  it.each(locales)("%s: every link resolves, unambiguously", (locale) => {
    const docs = importLocale(locale);
    const resolver = buildLinkResolver(docs.map(({ catalogEntry }) => catalogEntry));
    const outcomes = docs.flatMap(({ path, catalogEntry, links }) =>
      links.map((link) => ({
        from: path,
        link: `${link.kind}:${link.target}`,
        resolution: resolver.resolve(link, { documentId: catalogEntry.documentId, sourceId: SOURCE_ID, sourcePath: path }),
      })),
    );
    expect(outcomes.length).toBeGreaterThan(0);
    const bad = outcomes.filter(({ resolution }) => resolution.status === "UNRESOLVED" || resolution.ambiguousWith > 0);
    expect(bad).toEqual([]);
  });

  it.each(locales)("%s: covers Title, bare-stem, path-qualified wikilinks, relative .md and anchor links", (locale) => {
    const docs = importLocale(locale);
    const titles = new Set(docs.map(({ catalogEntry }) => normalizeLinkKey(catalogEntry.title)));
    const stems = new Set(docs.map(({ path }) => normalizeLinkKey(path.replace(/^.*\//, "").replace(/\.md$/, ""))));
    const links: ExtractedLink[] = docs.flatMap(({ links: found }) => found);
    const wiki = links.filter((link) => link.kind === "WIKI");
    const bare = wiki.filter((link) => !link.target.includes("/"));

    expect(wiki.some((link) => bare.includes(link) && titles.has(normalizeLinkKey(link.target)) && !stems.has(normalizeLinkKey(link.target)))).toBe(true);
    expect(bare.some((link) => stems.has(normalizeLinkKey(link.target)))).toBe(true);
    expect(wiki.some((link) => link.target.includes("/"))).toBe(true);
    expect(links.some((link) => link.kind === "PATH")).toBe(true);
    expect(links.some((link) => link.fragment !== null)).toBe(true);
  });

  it.each(locales)("%s: every anchor link names a heading that exists in its target", (locale) => {
    const docs = importLocale(locale);
    const resolver = buildLinkResolver(docs.map(({ catalogEntry }) => catalogEntry));
    const slugsOf = new Map(docs.map(({ catalogEntry, entry }) => [catalogEntry.documentId, collectHeadings(parseMarkdown(entry.markdown)).map(({ slug }) => slug)]));
    for (const { path, catalogEntry, links } of docs) {
      for (const link of links.filter((found) => found.fragment !== null)) {
        const resolution = resolver.resolve(link, { documentId: catalogEntry.documentId, sourceId: SOURCE_ID, sourcePath: path });
        if (resolution.status !== "RESOLVED") throw new Error(`${path}: ${link.target} does not resolve`);
        expect(slugsOf.get(resolution.documentId), `${path} -> ${link.target}#${link.fragment}`).toContain(link.fragment);
      }
    }
  });
});

describe("sample wiki zh-TW", () => {
  it("has Chinese text in every file body", () => {
    for (const { path, entry } of importLocale("zh-TW")) {
      expect(CJK.test(entry.markdown), path).toBe(true);
    }
  });

  it("links to a Chinese heading by its anchor within the locale", () => {
    const docs = importLocale("zh-TW");
    const resolver = buildLinkResolver(docs.map(({ catalogEntry }) => catalogEntry));
    const hit = docs.some(({ path, catalogEntry, links }) =>
      links.some((link) => {
        if (link.fragment === null) return false;
        const resolution = resolver.resolve(link, { documentId: catalogEntry.documentId, sourceId: SOURCE_ID, sourcePath: path });
        if (resolution.status !== "RESOLVED") return false;
        const target = docs.find(({ catalogEntry: candidate }) => candidate.documentId === resolution.documentId);
        const heading = collectHeadings(parseMarkdown(target?.entry.markdown ?? "")).find(({ slug }) => slug === link.fragment);
        return heading !== undefined && CJK.test(heading.text);
      }),
    );
    expect(hit).toBe(true);
  });
});

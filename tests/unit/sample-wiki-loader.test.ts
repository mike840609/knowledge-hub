// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadSampleWiki, SAMPLE_LOCALES, type SampleLocale } from "@/components/imports/sample-wiki";
import { selectFolder } from "@/components/imports/folder-import-form";

const PUBLIC = path.join(process.cwd(), "public");
const LOCALES: Array<{ locale: SampleLocale; root: string; sourceName: string; label: string }> = [
  { locale: "en", root: "sample-wiki-en", sourceName: "Sample wiki", label: "English" },
  { locale: "zh-TW", root: "sample-wiki-zh-TW", sourceName: "範例知識庫", label: "繁體中文" },
];

function readText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

/** Serves public/ from disk; `missing` URLs answer 404. */
function diskFetcher(missing: string[] = [], requested: string[] = []): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = decodeURI(String(input));
    requested.push(url);
    if (missing.some((suffix) => url.endsWith(suffix))) return new Response("not found", { status: 404 });
    return new Response(readFileSync(path.join(PUBLIC, url.replace(/^\//, ""))), { status: 200 });
  }) as typeof fetch;
}

const manifest = JSON.parse(readFileSync(path.join(PUBLIC, "sample-wiki", "manifest.json"), "utf8")) as {
  locales: Record<SampleLocale, { files: string[] }>;
};

describe.each(LOCALES)("loadSampleWiki($locale)", ({ locale, root, sourceName, label }) => {
  it("returns the seven files with a root-prefixed webkitRelativePath and the real text", async () => {
    const sample = await loadSampleWiki(locale, diskFetcher());
    expect(sample.sourceName).toBe(sourceName);
    expect(sample.root).toBe(root);
    expect(sample.label).toBe(label);
    expect(sample.files).toHaveLength(7);
    const paths = manifest.locales[locale].files;
    expect(sample.files.map((file) => (file as File & { webkitRelativePath: string }).webkitRelativePath)).toEqual(paths.map((p) => `${root}/${p}`));
    for (const [index, file] of sample.files.entries()) {
      expect(file.name).toBe(paths[index].split("/").pop());
      expect(file.type).toBe("text/markdown");
      expect(await readText(file)).toBe(readFileSync(path.join(PUBLIC, "sample-wiki", locale, paths[index]), "utf8"));
    }
  });

  it("feeds the form's own folder selection a root named after the sample, with root-relative paths", async () => {
    const sample = await loadSampleWiki(locale, diskFetcher());
    const selection = selectFolder(sample.files);
    expect(selection.rootName).toBe(root);
    expect(selection.staged.map((entry) => entry.relativePath).sort()).toEqual([...manifest.locales[locale].files].sort());
    expect(selection.staged.every((entry) => entry.markdown)).toBe(true);
  });

  it("rejects naming the path when one file answers 404, never returning a partial list", async () => {
    await expect(loadSampleWiki(locale, diskFetcher(["handbook/leave-policy.md"]))).rejects.toThrow(/handbook\/leave-policy\.md/);
  });
});

describe("SAMPLE_LOCALES", () => {
  it("offers one button label per manifest locale, equal to the manifest label", () => {
    const labels = JSON.parse(readFileSync(path.join(PUBLIC, "sample-wiki", "manifest.json"), "utf8")).locales as Record<string, { label: string }>;
    expect(SAMPLE_LOCALES.map((entry) => entry.locale).sort()).toEqual(Object.keys(labels).sort());
    for (const entry of SAMPLE_LOCALES) expect(entry.label).toBe(labels[entry.locale].label);
  });
});

describe("loadSampleWiki failures", () => {
  it("rejects when the manifest request fails", async () => {
    await expect(loadSampleWiki("en", diskFetcher(["manifest.json"]))).rejects.toThrow(/manifest/i);
  });

  it("rejects when the network itself fails", async () => {
    const offline = (async () => { throw new TypeError("Failed to fetch"); }) as typeof fetch;
    await expect(loadSampleWiki("en", offline)).rejects.toThrow();
  });

  it("rejects when the manifest has no entry for the locale", async () => {
    const empty = (async () => new Response(JSON.stringify({ locales: {} }), { status: 200 })) as typeof fetch;
    await expect(loadSampleWiki("zh-TW", empty)).rejects.toThrow(/zh-TW/);
  });
});

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

/** jsdom's Blob has no arrayBuffer()/text(), so read the exact bytes through FileReader. */
function readBytes(file: File): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(Buffer.from(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
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
      const onDisk = readFileSync(path.join(PUBLIC, "sample-wiki", locale, paths[index]));
      expect((await readBytes(file)).equals(onDisk)).toBe(true);
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
  it("keeps a byte-order mark: the file is the served bytes, not decoded text", async () => {
    const bom = Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from("# Title\n")]);
    const fetcher = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("manifest.json")) {
        return Response.json({ locales: { en: { label: "English", sourceName: "S", root: "r", files: ["a.md"] } } });
      }
      return new Response(bom);
    }) as typeof fetch;
    const [file] = (await loadSampleWiki("en", fetcher)).files;
    expect((await readBytes(file)).equals(bom)).toBe(true);
  });

  it("says one plain sentence when a proxy answers the manifest with a 200 HTML login page", async () => {
    const login = (async () => new Response("<!doctype html><title>Sign in</title>", { status: 200, headers: { "content-type": "text/html" } })) as typeof fetch;
    await expect(loadSampleWiki("en", login)).rejects.toThrow(
      "Could not load the sample wiki. Your session may have expired — reload the page and try again.",
    );
  });

  it.each(["text/html", "text/HTML; charset=utf-8"])(
    "says that sentence when one file is answered by a 200 HTML login page (%s), never importing it",
    async (contentType) => {
      const disk = diskFetcher();
      const fetcher = (async (input: RequestInfo | URL) =>
        String(input).endsWith("/handbook/onboarding.md")
          ? new Response("<!doctype html><title>Sign in</title>", { status: 200, headers: { "content-type": contentType } })
          : disk(input)) as typeof fetch;
      await expect(loadSampleWiki("en", fetcher)).rejects.toThrow(
        "Could not load the sample wiki. Your session may have expired — reload the page and try again.",
      );
    },
  );

  it.each([
    ["files missing", { label: "English", sourceName: "S", root: "r" }],
    ["files not an array", { label: "English", sourceName: "S", root: "r", files: "index.md" }],
    ["root missing", { label: "English", sourceName: "S", files: ["a.md"] }],
  ])("says that sentence when the manifest entry is malformed (%s), returning nothing", async (_name, entry) => {
    const requested: string[] = [];
    const fetcher = (async (input: RequestInfo | URL) => {
      requested.push(String(input));
      return Response.json({ locales: { en: entry } });
    }) as typeof fetch;
    await expect(loadSampleWiki("en", fetcher)).rejects.toThrow(/session may have expired/);
    expect(requested).toEqual(["/sample-wiki/manifest.json"]);
  });

  it("still reports the real reason for a genuine 404 file, not the session sentence", async () => {
    await expect(loadSampleWiki("en", diskFetcher(["index.md"]))).rejects.toThrow(/index\.md.*HTTP 404/);
  });

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

export type SampleLocale = "en" | "zh-TW";
export type SampleWiki = { files: File[]; sourceName: string; root: string; label: string };

type ManifestLocale = { label: string; sourceName: string; root: string; files: string[] };

const BASE = "/sample-wiki";

async function fetchOk(fetcher: typeof fetch, url: string, what: string): Promise<Response> {
  let response: Response;
  try {
    response = await fetcher(url);
  } catch {
    throw new Error(`Could not load ${what} (${url}). Check your connection and try again.`);
  }
  if (!response.ok) throw new Error(`Could not load ${what} (${url}): HTTP ${response.status}.`);
  return response;
}

const UNREADABLE =
  "Could not load the sample wiki. Your session may have expired — reload the page and try again.";

/**
 * A proxy that answers 200 with a login page, or a manifest of the wrong
 * shape, is one failure to the reader: say so in one sentence.
 */
async function readManifestEntry(fetcher: typeof fetch, locale: SampleLocale): Promise<ManifestLocale> {
  const response = await fetchOk(fetcher, `${BASE}/manifest.json`, "the sample wiki manifest");
  let manifest: { locales?: Partial<Record<SampleLocale, ManifestLocale>> } | null;
  try {
    manifest = await response.json();
  } catch {
    throw new Error(UNREADABLE);
  }
  const locales = manifest?.locales;
  if (locales && typeof locales === "object" && !(locale in locales)) {
    throw new Error(`The sample wiki manifest has no entry for ${locale}.`);
  }
  const entry = locales?.[locale];
  const valid =
    !!entry &&
    typeof entry.root === "string" &&
    typeof entry.sourceName === "string" &&
    typeof entry.label === "string" &&
    Array.isArray(entry.files) &&
    entry.files.every((file) => typeof file === "string");
  if (!entry || !valid) throw new Error(UNREADABLE);
  return entry;
}

/**
 * Fetches the bundled sample wiki as `File`s that look, to the folder-import
 * flow, exactly like a picked folder: `webkitRelativePath` is `<root>/<path>`.
 * Either every file loads or this throws; there is no partial result.
 */
export async function loadSampleWiki(locale: SampleLocale, fetcher: typeof fetch = fetch): Promise<SampleWiki> {
  const entry = await readManifestEntry(fetcher, locale);
  const files = await Promise.all(
    entry.files.map(async (relativePath) => {
      const url = `${BASE}/${locale}/${relativePath.split("/").map(encodeURIComponent).join("/")}`;
      const response = await fetchOk(fetcher, url, relativePath);
      // A proxy's login page answers 200 too; importing it as Markdown would be worse than failing.
      if (/^text\/html\b/i.test(response.headers.get("content-type") ?? "")) throw new Error(UNREADABLE);
      // Raw bytes, so a sample file is byte-identical to a picked one (BOM included).
      const bytes = await response.arrayBuffer();
      const file = new File([bytes], relativePath.split("/").pop() ?? relativePath, { type: "text/markdown" });
      Object.defineProperty(file, "webkitRelativePath", { value: `${entry.root}/${relativePath}`, enumerable: true });
      return file;
    }),
  );
  return { files, sourceName: entry.sourceName, root: entry.root, label: entry.label };
}

/**
 * Buttons are drawn before any fetch, so their labels are known statically;
 * a unit test keeps them equal to the manifest's `label`.
 */
export const SAMPLE_LOCALES: ReadonlyArray<{ locale: SampleLocale; label: string }> = [
  { locale: "en", label: "English" },
  { locale: "zh-TW", label: "繁體中文" },
];

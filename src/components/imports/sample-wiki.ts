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

/**
 * Fetches the bundled sample wiki as `File`s that look, to the folder-import
 * flow, exactly like a picked folder: `webkitRelativePath` is `<root>/<path>`.
 * Either every file loads or this throws; there is no partial result.
 */
export async function loadSampleWiki(locale: SampleLocale, fetcher: typeof fetch = fetch): Promise<SampleWiki> {
  const manifest = (await (await fetchOk(fetcher, `${BASE}/manifest.json`, "the sample wiki manifest")).json()) as {
    locales?: Partial<Record<SampleLocale, ManifestLocale>>;
  };
  const entry = manifest.locales?.[locale];
  if (!entry) throw new Error(`The sample wiki manifest has no entry for ${locale}.`);
  const files = await Promise.all(
    entry.files.map(async (relativePath) => {
      const url = `${BASE}/${locale}/${relativePath.split("/").map(encodeURIComponent).join("/")}`;
      const text = await (await fetchOk(fetcher, url, relativePath)).text();
      const file = new File([text], relativePath.split("/").pop() ?? relativePath, { type: "text/markdown" });
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

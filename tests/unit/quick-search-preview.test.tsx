// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ⌘K on a wide window, laid out like a reading site's search: the results with their matched passage on the
 * left, the active result's document previewed on the right. Narrow windows keep the single list.
 */
const navigation = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigation.push }),
  usePathname: () => "/w/ws-1/home",
}));
vi.mock("@/components/shell/use-workspace-authorization", () => ({
  useWorkspaceAuthorization: () => ({
    access: { workspace: { type: "PERSONAL" }, actions: { canSearch: true } },
    confirmed: true,
  }),
}));
vi.mock("@/components/knowledge/use-document-shortcuts", () => ({
  documentShortcutKey: (sourceId: string, documentId: string) => `${sourceId}:${documentId}`,
  useDocumentShortcuts: () => ({ shortcuts: { recent: [], favorites: [] }, update: () => {}, ready: true }),
}));
vi.mock("@/components/actions/action-registry", () => ({
  actionsFor: () => [],
  matchActions: () => [],
  actionGroupLabels: {},
}));
vi.mock("@/components/actions/action-menu", () => ({ useActionRunner: () => () => {} }));
// The reader's own rendering is tested elsewhere; here it is the document's text and one link of each kind
// the reader writes: an in-page anchor, an external link (a new tab) and a document link.
vi.mock("@/components/knowledge/markdown-renderer", () => ({
  MarkdownRenderer: ({ markdown }: { markdown: string }) => (
    <article>
      <p>{markdown}</p>
      <h2 id="part">Part</h2>
      <a href="#part">anchor</a>
      <a href="https://example.com/" target="_blank" rel="noreferrer">external</a>
      <a href={"/w/ws-1/knowledge/src-1/other"}>document</a>
    </article>
  ),
}));

import { QuickSearch } from "@/components/search/quick-search";
import { SearchPreview, termRanges } from "@/components/search/search-preview";

const hits = [
  { documentId: "doc-a", sourceId: "src-1", title: "Alpha", sourceName: "Notes", snippet: "the deploy runbook" },
  { documentId: "doc-b", sourceId: "src-1", title: "Beta", sourceName: "Notes", snippet: "deploy on Friday" },
];
const markdown: Record<string, string> = { "doc-a": "Alpha body about Deploy", "doc-b": "Beta body" };

let root: Root;
let container: HTMLDivElement;
let fetchMock: ReturnType<typeof vi.fn>;
let failPeek = false;
// A query whose answer never arrives: the palette is left waiting on it.
let heldQuery: string | null = null;

function stubWidth(wide: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: wide, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  navigation.push.mockClear();
  failPeek = false;
  heldQuery = null;
  fetchMock = vi.fn(async (url: string) => {
    const peek = /\/api\/documents\/([^/]+)\/peek/.exec(url);
    if (peek) {
      if (failPeek) return { ok: false, json: async () => ({}) };
      return { ok: true, json: async () => ({ title: peek[1], markdown: markdown[peek[1]] }) };
    }
    if (new URL(url, "http://localhost").searchParams.get("q") === heldQuery) return new Promise(() => {});
    return { ok: true, json: async () => ({ hits, tooLong: false, timedOut: false }) };
  });
  vi.stubGlobal("fetch", fetchMock);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const wait = (ms: number) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
const peeks = () => fetchMock.mock.calls.map(([url]) => String(url)).filter((url) => url.includes("/peek"));
const preview = () => document.querySelector('[aria-label="Document preview"]');

async function search(q: string) {
  if (!document.querySelector('input[role="combobox"]')) {
    await act(async () => root.render(<QuickSearch workspaceId="ws-1" />));
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
    });
  }
  const input = document.querySelector<HTMLInputElement>('input[role="combobox"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, q);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await wait(250);
  return input;
}

it("lists each result with its matched passage, and previews the first one on a wide window", async () => {
  stubWidth(true);
  await search("deploy");
  const rows = [...document.querySelectorAll('[role="option"]')].map((el) => el.textContent);
  expect(rows[0]).toContain("Alpha");
  expect(rows[0]).toContain("the deploy runbook");
  expect(peeks()).toEqual(["/api/documents/doc-a/peek?brief"]);
  expect(preview()?.textContent).toContain("Alpha body about Deploy");
});

it("previews whichever result the arrow keys move to", async () => {
  stubWidth(true);
  const input = await search("deploy");
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  });
  await wait(200);
  expect(preview()?.textContent).toContain("Beta body");
});

it("keeps the single list on a narrow window and fetches no preview", async () => {
  stubWidth(false);
  await search("deploy");
  expect(document.querySelectorAll('[role="option"]')).toHaveLength(2);
  // The narrow list keeps its rows as they were: the passage on the source's line.
  expect(document.querySelector('[role="option"]')?.textContent).toContain("Notes · the deploy runbook");
  expect(preview()).toBeNull();
  expect(peeks()).toEqual([]);
});

it("says so when a document cannot be previewed", async () => {
  stubWidth(true);
  failPeek = true;
  await search("deploy");
  expect(preview()?.textContent).toContain("cannot be previewed");
});

const click = async (label: string) => {
  const link = [...preview()!.querySelectorAll("a")].find((a) => a.textContent === label)!;
  let prevented = false;
  await act(async () => {
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(event);
    prevented = event.defaultPrevented;
  });
  await wait(50);
  return prevented;
};
const paletteOpen = () => document.querySelector('input[role="combobox"]') !== null;

it("closes the palette when a document link in the preview is followed", async () => {
  stubWidth(true);
  await search("deploy");
  await click("document");
  expect(paletteOpen()).toBe(false);
});

it("keeps the palette open for an in-page anchor, which scrolls the preview to its heading instead of the page", async () => {
  stubWidth(true);
  const scrolled: Element[] = [];
  // jsdom lays nothing out and has no scrollIntoView; record which element is asked to come into view.
  const original = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function (this: Element) { scrolled.push(this); };
  try {
    await search("deploy");
    expect(await click("anchor")).toBe(true);
    expect(paletteOpen()).toBe(true);
    expect(scrolled.at(-1)?.id).toBe("part");
  } finally {
    Element.prototype.scrollIntoView = original;
  }
});

it("keeps the previewed document, and each row's passage, while the next answer is awaited", async () => {
  stubWidth(true);
  await search("deploy");
  heldQuery = "deploys";
  await search("deploys");
  expect(preview()?.textContent).toContain("Alpha body about Deploy");
  expect(document.querySelectorAll("[data-stale-results] [data-stale-snippet]")).toHaveLength(2);
});

it("keeps the palette open for an external link, which opens in a new tab", async () => {
  stubWidth(true);
  await search("deploy");
  await click("external");
  expect(paletteOpen()).toBe(true);
});

it("stays split on a wide window when a query finds no documents", async () => {
  stubWidth(true);
  fetchMock.mockImplementation(async () => ({ ok: true, json: async () => ({ hits: [], tooLong: false, timedOut: false }) }));
  await search("zz");
  expect(preview()?.textContent).toContain("Select a document to preview");
});

it("finds every term in the rendered text, ignoring case, and nothing without terms", () => {
  const root = document.createElement("div");
  root.innerHTML = "<p>Deploy the <b>deploy</b> job</p><p>no match</p>";
  expect(termRanges(root, ["deploy"]).map((range) => range.toString())).toEqual(["Deploy", "deploy"]);
  expect(termRanges(root, [])).toEqual([]);
});

it("leaves out text a reader does not see, and text whose lower case changes its length", () => {
  const root = document.createElement("div");
  root.innerHTML = '<p><span class="sr-only">deploy</span><span aria-hidden="true">deploy</span></p>'
    + "<details><summary>deploy</summary><p>deploy</p></details><p>İİ deploy</p><p>last deploy</p>";
  const found = termRanges(root, ["deploy"]).map((range) => range.startContainer.parentElement?.textContent);
  expect(found).toEqual(["deploy", "last deploy"]);
});

describe("SearchPreview", () => {
  let highlighted: number[];
  let cleared: string[];
  beforeEach(() => {
    highlighted = [];
    cleared = [];
    vi.stubGlobal("Highlight", class { constructor(...ranges: Range[]) { highlighted.push(ranges.length); } });
    vi.stubGlobal("CSS", { highlights: { set: () => {}, delete: (name: string) => { cleared.push(name); } } });
  });

  it("clears its marks when the document goes away", async () => {
    await show("doc-a");
    await wait(200);
    expect(cleared).toEqual([]);
    await show(null);
    expect(cleared).toEqual(["search-preview"]);
  });
  const show = (documentId: string | null) =>
    act(async () => root.render(<SearchPreview documentId={documentId} terms={["deploy"]} onLeave={() => {}} />));

  it("marks the terms on every visit to a document, cached or not, and fetches it once", async () => {
    const marksAfterVisit: number[] = [];
    for (const id of ["doc-a", null, "doc-a", null, "doc-a"]) {
      const before = highlighted.length;
      await show(id);
      await wait(200);
      if (id) marksAfterVisit.push(highlighted.slice(before).filter((count) => count > 0).length);
    }
    // Each visit marks the terms afresh; the old marks went with the old text.
    expect(marksAfterVisit.every((count) => count > 0)).toBe(true);
    expect(peeks()).toEqual(["/api/documents/doc-a/peek?brief"]);
  });

  it("never shows the previous document under a new selection", async () => {
    await show("doc-a");
    await wait(200);
    expect(preview()?.textContent).toContain("Alpha body");
    await show("doc-b");
    expect(preview()?.textContent).not.toContain("Alpha body");
    await wait(200);
    expect(preview()?.textContent).toContain("Beta body");
  });

  it("fetches only the row that is stopped on", async () => {
    await show("doc-a");
    await show("doc-b");
    await wait(200);
    expect(peeks()).toEqual(["/api/documents/doc-b/peek?brief"]);
  });
});

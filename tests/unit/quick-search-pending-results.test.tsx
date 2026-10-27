// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

/**
 * ⌘K while the next search is in flight. The palette used to blank its results on every keystroke and show a
 * skeleton until the answer came. It now keeps the previous answer on screen, dimmed — but those documents
 * answer the previous query, so they must not be choosable: Enter, a click or Tab may not reach one.
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
// Actions are not what is under test; with none, every row in the list is a document.
vi.mock("@/components/actions/action-registry", () => ({
  actionsFor: () => [],
  matchActions: () => [],
  actionGroupLabels: {},
}));
vi.mock("@/components/actions/action-menu", () => ({ useActionRunner: () => () => {} }));

import { QuickSearch } from "@/components/search/quick-search";

type Hit = { documentId: string; sourceId: string; title: string; sourceName: string; snippet: string };
const hit = (id: string, title: string): Hit => ({ documentId: id, sourceId: "src-1", title, sourceName: "Notes", snippet: "" });

// Each query's answer is held until the test releases it.
let pending: Map<string, (hits: Hit[]) => void>;
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  navigation.push.mockClear();
  pending = new Map();
  vi.stubGlobal("fetch", vi.fn((url: string) => {
    const q = new URL(url, "http://localhost").searchParams.get("q") ?? "";
    return new Promise((resolve) => {
      pending.set(q, (hits) => resolve({ ok: true, json: async () => ({ hits, tooLong: false, timedOut: false }) }));
    });
  }));
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

async function openPalette() {
  await act(async () => root.render(<QuickSearch workspaceId="ws-1" />));
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
  });
  const input = document.querySelector<HTMLInputElement>('input[role="combobox"]');
  expect(input).not.toBeNull();
  return input!;
}

async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  // Past the debounce that holds every keystroke after the first.
  await wait(250);
}

async function answer(q: string, hits: Hit[]) {
  expect(pending.has(q), `a request for "${q}"`).toBe(true);
  await act(async () => pending.get(q)!(hits));
  await wait(0);
}

const options = () => [...document.querySelectorAll('[role="option"]')].map((el) => el.textContent ?? "");
const stale = () => document.querySelector("[data-stale-results]");

it("keeps the previous answer on screen while the next one is in flight", async () => {
  const input = await openPalette();
  await type(input, "pro");
  await answer("pro", [hit("doc-a", "Probe A")]);
  expect(options().some((text) => text.includes("Probe A"))).toBe(true);

  await type(input, "prob");
  expect(stale()?.textContent).toContain("Probe A");
  expect(document.body.textContent).toContain("Searching");
});

it("does not let a previous answer be chosen: it is no option, and Enter does not open it", async () => {
  const input = await openPalette();
  await type(input, "pro");
  await answer("pro", [hit("doc-a", "Probe A")]);
  await type(input, "prob");

  expect(options()).toEqual([]);
  expect(stale()?.hasAttribute("inert")).toBe(true);
  expect(stale()?.getAttribute("aria-hidden")).toBe("true");
  expect(stale()?.querySelector("button, a, [tabindex]")).toBeNull();

  await act(async () => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  const opened = navigation.push.mock.calls.map(([href]) => String(href));
  expect(opened.some((href) => href.includes("doc-a"))).toBe(false);
  // With nothing to choose, Enter does what it always did then: the full search, for the current text.
  expect(opened).toEqual(["/w/ws-1/search?q=prob"]);
});

it("replaces the previous answer with the new one, which can be chosen", async () => {
  const input = await openPalette();
  await type(input, "pro");
  await answer("pro", [hit("doc-a", "Probe A")]);
  await type(input, "prob");
  await answer("prob", [hit("doc-b", "Probe B")]);

  expect(stale()).toBeNull();
  expect(options()).toHaveLength(1);
  expect(options()[0]).toContain("Probe B");
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  expect(navigation.push).toHaveBeenCalledWith("/w/ws-1/knowledge/src-1/doc-b");
});

it("shows the skeleton when there is no previous answer to keep", async () => {
  const input = await openPalette();
  await type(input, "pro");

  expect(stale()).toBeNull();
  expect(options()).toEqual([]);
  expect(document.body.textContent).toContain("Searching");
});

it("keeps nothing from an answer that found nothing", async () => {
  const input = await openPalette();
  await type(input, "zz");
  await answer("zz", []);
  await type(input, "zzz");

  expect(stale()).toBeNull();
  expect(document.body.textContent).toContain("Searching");
});

it("forgets the previous answer once the text is cleared", async () => {
  const input = await openPalette();
  await type(input, "pro");
  await answer("pro", [hit("doc-a", "Probe A")]);
  await type(input, "");
  await type(input, "x");

  expect(stale()).toBeNull();
  expect(document.body.textContent).not.toContain("Probe A");
});

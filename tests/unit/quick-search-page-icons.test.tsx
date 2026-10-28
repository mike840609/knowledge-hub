// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

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
  useDocumentShortcuts: () => ({ shortcuts: { recent: ["src-1:doc-a"], favorites: [] }, update: () => {}, ready: true }),
}));
vi.mock("@/components/actions/action-registry", () => ({
  actionsFor: () => [],
  matchActions: () => [],
  actionGroupLabels: {},
}));
vi.mock("@/components/actions/action-menu", () => ({ useActionRunner: () => () => {} }));

import { QuickSearch } from "@/components/search/quick-search";

let root: Root;
let container: HTMLDivElement;
const wait = (ms: number) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (String(url).includes("/recent-documents")) {
      return Response.json({ hits: [{ documentId: "doc-a", sourceId: "src-1", title: "Pinned note", sourceName: "Notes", snippet: "", pageIcon: "📌" }] });
    }
    return Response.json({ hits: [{ documentId: "doc-b", sourceId: "src-1", title: "Needle", sourceName: "Notes", snippet: "A needle.", pageIcon: "🧭" }], tooLong: false, timedOut: false });
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

async function openPalette() {
  await act(async () => root.render(<QuickSearch workspaceId="ws-1" />));
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
  });
  await wait(20);
  const input = document.querySelector<HTMLInputElement>('input[role="combobox"]');
  expect(input).not.toBeNull();
  return input!;
}

it("shows page icons for a recent document and a searched one", async () => {
  const input = await openPalette();
  expect(document.body.textContent).toContain("Pinned note");
  expect(document.body.textContent).toContain("📌");

  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "need");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await wait(250);
  expect(document.body.textContent).toContain("Needle");
  expect(document.body.textContent).toContain("🧭");
});

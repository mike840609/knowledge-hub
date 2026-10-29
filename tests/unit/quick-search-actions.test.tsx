// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DocumentTopbarContext, type DocumentTopbarState } from "@/components/shell/document-topbar-context";

/**
 * The command palette is a second surface for the document actions. It must receive the same
 * trusted owner flag as the row menu, or a My Space owner loses Share link… from ⌘K.
 */
const authorization = vi.hoisted(() => ({
  access: {
    workspace: { type: "PERSONAL" as const },
    actions: { canSearch: true },
    isPersonalOwner: true,
  },
  confirmed: true,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/w/ws-1/knowledge/src-1/doc-1",
}));
vi.mock("@/components/shell/use-workspace-authorization", () => ({
  useWorkspaceAuthorization: () => authorization,
}));
vi.mock("@/components/knowledge/use-document-shortcuts", () => ({
  documentShortcutKey: (sourceId: string, documentId: string) => `${sourceId}:${documentId}`,
  useDocumentShortcuts: () => ({ shortcuts: { recent: [], favorites: [] }, update: () => {}, ready: true }),
}));
vi.mock("@/components/actions/action-menu", () => ({ useActionRunner: () => () => {} }));

import { QuickSearch } from "@/components/search/quick-search";

const topbar: DocumentTopbarState = {
  pathname: "/w/ws-1/knowledge/src-1/doc-1",
  title: "Onboarding",
  visible: true,
  onDetailsClick: () => {},
  target: {
    documentId: "doc-1",
    sourceId: "src-1",
    label: "Onboarding",
    ownership: "HUB_MANAGED",
    status: "ACTIVE",
    sourceStatus: "ACTIVE",
    revision: "CURRENT",
  },
};

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ hits: [], tooLong: false, timedOut: false }), { status: 200 })));
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

function openPalette(isPersonalOwner: boolean) {
  authorization.access.isPersonalOwner = isPersonalOwner;
  act(() => root.render(
    <DocumentTopbarContext.Provider value={{ document: topbar, setDocument: () => {} }}>
      <QuickSearch workspaceId="ws-1" />
    </DocumentTopbarContext.Provider>,
  ));
  act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true })); });
  return [...document.querySelectorAll('[role="option"]')].map((element) => element.textContent ?? "");
}

it("offers Share link… to the My Space owner in the palette", () => {
  expect(openPalette(true).some((text) => text.includes("Share link…"))).toBe(true);
});

it("does not offer Share link… to a member who does not own the My Space", () => {
  expect(openPalette(false).some((text) => text.includes("Share link…"))).toBe(false);
});

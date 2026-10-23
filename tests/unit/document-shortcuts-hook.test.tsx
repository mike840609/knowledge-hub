// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useDocumentShortcuts } from "@/components/knowledge/use-document-shortcuts";
import { rememberDocument, type DocumentShortcuts } from "@/lib/document-shortcuts";

// A transition is work React may leave for later. Held here until the test lets it go, which is
// what a busy page does to one: the state it sets has not arrived when the next thing happens.
const transitions: (() => void)[] = [];
vi.mock("react", async (original) => ({ ...(await original<typeof import("react")>()), startTransition: (run: () => void) => void transitions.push(run) }));
vi.mock("@/components/shell/use-workspace-authorization", () => ({ useWorkspaceAuthorization: () => ({ access: { workspace: { type: "PERSONAL" } } }) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => toast }));
vi.mock("@/lib/favorite-sync", () => ({ migrateLocalFavorites: async () => {}, pendingFavoriteWrites: async () => {}, enqueueFavoriteWrite: async () => {} }));
const toast = vi.fn();

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const KEY = "kh:document-shortcuts:ws";
const stored = () => JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<DocumentShortcuts>;

let root: Root;
let api: ReturnType<typeof useDocumentShortcuts>;
let rerender: () => void;
/** The answer to the favourites request, given when the test says. */
let answerFavorites: (items: { key: string; sourceId?: string }[]) => Promise<void>;

function Host() {
  api = useDocumentShortcuts("ws");
  const [, set] = useState(0);
  rerender = () => set((count) => count + 1);
  return null;
}

beforeEach(async () => {
  localStorage.clear();
  transitions.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          answerFavorites = async (items) => {
            await act(async () => resolve(new Response(JSON.stringify(items), { status: 200 })));
          };
        }),
    ),
  );
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

it("keeps a document that was just opened when the favourites arrive before its state has", async () => {
  localStorage.setItem(KEY, JSON.stringify({ recent: ["s:a"], favorites: [] }));
  await act(async () => root.render(<Host />));

  // The sidebar's effect: the reader entered document b.
  await act(async () => api.update((previous) => rememberDocument(previous, "s:b")));
  expect(stored().recent).toEqual(["s:b", "s:a"]);

  // Anything else on the page renders — a filter, a panel — while that update's state is still on its way,
  await act(async () => rerender());
  // and then the favourites request made on arrival comes back and is written beside what is remembered.
  await answerFavorites([{ key: "favorite:f", sourceId: "s" }]);

  expect(stored().favorites).toEqual(["s:f"]);
  expect(stored().recent).toEqual(["s:b", "s:a"]);
});

it("asks for the favorites view, not every personal item", async () => {
  await act(async () => root.render(<Host />));
  expect(fetch).toHaveBeenCalledWith("/api/workspaces/ws/personal?view=favorites", { cache: "no-store" });
  await answerFavorites([]);
});

it("still shows what was stored and what was just opened once the state arrives", async () => {
  localStorage.setItem(KEY, JSON.stringify({ recent: ["s:a"], favorites: [] }));
  await act(async () => root.render(<Host />));
  await act(async () => api.update((previous) => rememberDocument(previous, "s:b")));
  await act(async () => rerender());
  await answerFavorites([]);
  await act(async () => transitions.splice(0).forEach((run) => run()));
  expect(api.shortcuts.recent).toEqual(["s:b", "s:a"]);
});

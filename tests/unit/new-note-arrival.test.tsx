// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NewNoteStarter, hasNewNoteDraft, takeNewNote } from "@/components/knowledge/new-note-starter";
import { takeTyped } from "@/components/knowledge/typing-ahead";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const navigation = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: navigation.replace }) }));
vi.mock("@/components/shell/refresh-on-arrival", () => ({ refreshOnArrival: vi.fn() }));

let host: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  host = document.body.appendChild(document.createElement("div"));
  navigation.replace.mockClear();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ documentId: "doc-1", sourceId: "src-1" }), { status: 200, headers: { "content-type": "application/json" } })));
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host.remove();
  takeTyped();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function start() {
  act(() => {
    root = createRoot(host);
    root.render(createElement(NewNoteStarter, { workspaceId: "ws-1", userId: "user-1", folderId: null, seedTitle: null, composeHref: "/w/ws-1/knowledge/new?compose=" }));
  });
  for (let attempt = 0; attempt < 20 && navigation.replace.mock.calls.length === 0; attempt++) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  }
  expect(navigation.replace).toHaveBeenCalledWith("/w/ws-1/knowledge/src-1/doc-1");
}

it("hands the starter's fields to the editor once, then forgets them", async () => {
  await start();
  const title = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Title"]')!;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  act(() => { setter.call(title, "Typed while creating"); title.dispatchEvent(new Event("input", { bubbles: true })); });
  expect(hasNewNoteDraft("doc-1")).toBe(true);
  expect(takeNewNote("doc-1")).toMatchObject({ text: "Typed while creating", entered: false });
  expect(takeNewNote("doc-1")).toBeNull();
});

it("does not replay an arrival the editor never reached after ten seconds", async () => {
  await start();
  expect(hasNewNoteDraft("doc-1")).toBe(true);
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 10_001);
  expect(hasNewNoteDraft("doc-1")).toBe(false);
  expect(takeNewNote("doc-1")).toBeNull();
});

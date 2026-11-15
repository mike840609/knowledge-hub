// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), usePathname: () => "/w/ws/knowledge" }));
const request = vi.hoisted(() => ({ reject: null as null | ((error: Error) => void) }));
vi.mock("@/components/workspaces/governance-error", () => ({
  governanceRequest: () => new Promise((_, reject) => { request.reject = reject; }),
}));

import { PageIconPicker } from "@/components/knowledge/page-icon-picker";
import { ToastProvider } from "@/components/ui/toast";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); document.body.innerHTML = ""; vi.unstubAllGlobals(); });

it("keeps focus on the chosen cell while the save is in flight and after it fails", async () => {
  await act(async () => root.render(<ToastProvider><PageIconPicker documentId="doc-1" icon={null} editable /></ToastProvider>));
  await act(async () => document.querySelector<HTMLButtonElement>("button[aria-haspopup], button[aria-expanded]")!.click());
  const cell = document.querySelector<HTMLButtonElement>("button[data-emoji]")!;
  cell.focus();
  await act(async () => cell.click());
  // A browser moves focus off a button that becomes disabled (jsdom does not), so the cell is only
  // marked busy while the save is in flight, and a second choice is ignored.
  expect(cell.disabled).toBe(false);
  expect(cell.getAttribute("aria-disabled")).toBe("true");
  expect(document.activeElement).toBe(cell);
  await act(async () => request.reject!(new Error("no")));
  expect(document.activeElement).toBe(cell);
});

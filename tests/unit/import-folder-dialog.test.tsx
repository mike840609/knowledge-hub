// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ back: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ back: state.back }) }));
vi.mock("next/link", async () => {
  const { createElement } = await import("react");
  return {
    default: ({ href, children }: { href: string; children: React.ReactNode }) =>
      createElement("a", { href }, children),
  };
});
vi.mock("@/components/imports/folder-import-form", async () => {
  const { createElement } = await import("react");
  return {
    FolderImportForm: ({ onBusyChange }: { onBusyChange?: (busy: boolean) => void }) =>
      createElement(
        "div",
        null,
        createElement("button", { type: "button", onClick: () => onBusyChange?.(true) }, "Start"),
        createElement("button", { type: "button", onClick: () => onBusyChange?.(false) }, "Finish"),
      ),
  };
});

import { ImportFolderDialog } from "@/components/imports/import-folder-dialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  state.back.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const limits = { maxMarkdownFileBytes: 5 * 1024 * 1024, maxAssetFileBytes: 8, maxAssetTotalBytes: 16 };

function render(canImport = true) {
  act(() => root.render(<ImportFolderDialog workspaceId="w1" canImport={canImport} limits={limits} />));
}

function button(name: string): HTMLButtonElement {
  const element = [...document.querySelectorAll("button")].find((candidate) => candidate.textContent === name);
  if (!element) throw new Error(`${name} button not mounted`);
  return element as HTMLButtonElement;
}

function closeButton(): HTMLButtonElement {
  const element = document.querySelector<HTMLButtonElement>('button[aria-label="Close dialog"]');
  if (!element) throw new Error("close button not mounted");
  return element;
}

it("goes back to the Sources history entry when closed, and still closes if navigation no-ops", () => {
  render();
  act(() => closeButton().click());
  expect(state.back).toHaveBeenCalledOnce();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it("keeps the dialog open while the import is running", () => {
  render();
  act(() => button("Start").click());
  expect(closeButton().disabled).toBe(true);
  act(() => closeButton().click());
  expect(state.back).not.toHaveBeenCalled();

  act(() => button("Finish").click());
  expect(closeButton().disabled).toBe(false);
  act(() => closeButton().click());
  expect(state.back).toHaveBeenCalledOnce();
});

it("explains a read-only workspace instead of rendering the form", () => {
  render(false);
  expect(document.body.textContent).toContain("This workspace is read-only. Import is unavailable.");
  expect(document.body.textContent).not.toContain("Start");
});

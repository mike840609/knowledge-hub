// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ back: vi.fn(), push: vi.fn(), replace: vi.fn(), collect: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ back: state.back, push: state.push, replace: state.replace }) }));
vi.mock("@/components/shell/use-workspace-authorization", () => ({
  requestWorkspaceAccessCheck: vi.fn(),
  useWorkspaceAuthorization: () => ({ access: { actions: { canImport: true } }, confirmed: true }),
}));
vi.mock("@/components/imports/folder-handle-store", () => ({
  isDirectoryPickerSupported: () => true,
  getRememberedFolderMeta: () => null,
  rememberFolderHandle: vi.fn(),
  stashPendingHandle: vi.fn(),
  loadRememberedHandle: vi.fn(),
  forgetRememberedFolder: vi.fn(),
  collectHandleFiles: state.collect,
}));

import { ImportFolderDialog } from "@/components/imports/import-folder-dialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let release!: (files: File[]) => void;

beforeEach(() => {
  state.back.mockClear();
  state.push.mockClear();
  state.replace.mockClear();
  state.collect.mockReset();
  state.collect.mockReturnValue(new Promise((resolve) => { release = resolve; }));
  Object.defineProperty(window, "showDirectoryPicker", {
    value: vi.fn().mockResolvedValue({ name: "Notes" }),
    configurable: true,
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  delete (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker;
  vi.unstubAllGlobals();
});

const limits = { maxMarkdownFileBytes: 5 * 1024 * 1024, maxAssetFileBytes: 8, maxAssetTotalBytes: 16 };

function closeButton(): HTMLButtonElement {
  const element = document.querySelector<HTMLButtonElement>('button[aria-label="Close dialog"]');
  if (!element) throw new Error("close button not mounted");
  return element;
}

function chooseFolderButton(): HTMLButtonElement {
  const element = [...document.querySelectorAll("button")].find((candidate) => candidate.textContent === "Choose folder");
  if (!element) throw new Error("Choose folder button not mounted");
  return element as HTMLButtonElement;
}

it("locks dismissal from the real form while the folder scan is running", async () => {
  act(() => root.render(<ImportFolderDialog workspaceId="w1" canImport limits={limits} />));
  expect(closeButton().disabled).toBe(false);

  await act(async () => { chooseFolderButton().click(); });
  await act(async () => {});
  expect(closeButton().disabled).toBe(true);

  act(() => closeButton().click());
  act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
  expect(state.back).not.toHaveBeenCalled();

  await act(async () => { release([]); });
  expect(closeButton().disabled).toBe(false);
  act(() => closeButton().click());
  expect(state.back).toHaveBeenCalledOnce();
});

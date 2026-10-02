// @vitest-environment jsdom
import { StrictMode, act } from "react";
import { renderToString } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SyncNowButton } from "@/components/sources/sync-now-button";

const store = vi.hoisted(() => ({
  supported: true,
  meta: null as { rootName: string; lastSyncAt: string } | null,
  handle: Symbol("folder-handle") as unknown,
  files: [] as File[],
  isDirectoryPickerSupported: vi.fn(() => store.supported),
  getRememberedFolderMeta: vi.fn(() => store.meta),
  rememberFolderHandle: vi.fn(async () => {}),
  loadRememberedHandle: vi.fn(async () =>
    store.handle ? { handle: store.handle, rootName: "notes" } : null,
  ),
  forgetRememberedFolder: vi.fn(() => {}),
  collectHandleFiles: vi.fn(async () => store.files),
}));

vi.mock("@/components/imports/folder-handle-store", () => ({
  isDirectoryPickerSupported: store.isDirectoryPickerSupported,
  getRememberedFolderMeta: store.getRememberedFolderMeta,
  rememberFolderHandle: store.rememberFolderHandle,
  loadRememberedHandle: store.loadRememberedHandle,
  forgetRememberedFolder: store.forgetRememberedFolder,
  collectHandleFiles: store.collectHandleFiles,
}));

const folderImport = vi.hoisted(() => ({
  runFolderImport: vi.fn(async () => "snap-1"),
}));
vi.mock("@/components/imports/folder-import-form", () => ({
  runFolderImport: folderImport.runFolderImport,
}));

const auth = vi.hoisted(() => ({
  canImport: true,
  confirmed: true,
}));
vi.mock("@/components/shell/use-workspace-authorization", () => ({
  useWorkspaceAuthorization: () => ({
    access: { actions: { canImport: auth.canImport } },
    confirmed: auth.confirmed,
  }),
}));

const navigation = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigation.push }),
}));

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  store.supported = true;
  store.meta = { rootName: "notes", lastSyncAt: "2026-10-02T00:00:00.000Z" };
  store.handle = Symbol("folder-handle") as unknown;
  store.files = [];
  auth.canImport = true;
  auth.confirmed = true;
  vi.clearAllMocks();
  navigation.push.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function renderButton() {
  await act(async () => {
    root.render(<SyncNowButton workspaceId="ws-1" sourceId="src-1" />);
  });
}

function syncButton(): HTMLButtonElement | null {
  return container.querySelector('button[aria-label="Sync now"]');
}

function clickSync(): void {
  const button = syncButton();
  if (!button) throw new Error('Button "Sync now" not found');
  act(() => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

it("renders nothing when the directory picker is unsupported", async () => {
  store.supported = false;
  await renderButton();
  expect(container.innerHTML).toBe("");
});

it("renders nothing while workspace access is unconfirmed", async () => {
  auth.confirmed = false;
  await renderButton();
  expect(container.innerHTML).toBe("");
});

it("renders nothing without the import capability", async () => {
  auth.canImport = false;
  await renderButton();
  expect(container.innerHTML).toBe("");
});

it("renders nothing when no folder is remembered", async () => {
  store.meta = null;
  await renderButton();
  expect(container.innerHTML).toBe("");
});

it("renders an icon-only Sync now button: accessible name, no visible text, icon shape", async () => {
  await renderButton();
  const button = syncButton();
  expect(button).not.toBeNull();
  expect(button?.textContent?.trim()).toBe("");
  expect(button?.className).toContain("kh-icon-control");
  expect(button?.className).toContain("bg-kh-bg-selected");
  expect(button?.className).toContain("text-kh-selected-text");
  expect(button?.className).not.toContain("bg-kh-primary");
  expect(button?.querySelector("svg")).not.toBeNull();
  expect(container.textContent).not.toContain("Last folder: notes");
  expect(container.textContent).not.toContain("Forget");
});

it("reveals the re-scan tip on keyboard focus", async () => {
  await renderButton();
  const button = syncButton();
  expect(button).not.toBeNull();
  await act(async () => {
    button?.focus();
  });
  expect(document.body.textContent).toContain("Sync now - re-scan notes");
});

it("reveals the re-scan tip on hover", async () => {
  await renderButton();
  const button = syncButton();
  expect(button).not.toBeNull();
  await act(async () => {
    // Base UI opens hover tooltips off native mouseenter + a rest delay, and
    // only for mouse-like pointers (pointerenter seeds the pointer type).
    button?.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }));
    button?.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false }));
    button?.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, movementX: 8, movementY: 8 }));
    await new Promise((resolve) => setTimeout(resolve, 900));
  });
  expect(document.body.textContent).toContain("Sync now - re-scan notes");
});

it("loads the remembered folder in an effect: server render shows nothing and reads no browser storage", () => {
  const html = renderToString(<SyncNowButton workspaceId="ws-1" sourceId="src-1" />);
  expect(html).toBe("");
  expect(store.isDirectoryPickerSupported).not.toHaveBeenCalled();
  expect(store.getRememberedFolderMeta).not.toHaveBeenCalled();
});

it("renders no Forget control", async () => {
  await renderButton();
  const forget = [...container.querySelectorAll("button")].find((element) =>
    element.textContent?.includes("Forget"),
  );
  expect(forget).toBeUndefined();
  expect(store.forgetRememberedFolder).not.toHaveBeenCalled();
});

it("asks to pick the folder again when the saved handle is unavailable", async () => {
  store.handle = null;
  await renderButton();
  clickSync();
  await act(async () => {});
  const status = container.querySelector('[role="status"]');
  expect(status?.textContent).toContain("Saved folder is unavailable - pick the folder again");
  expect(container.querySelector('a[href="/w/ws-1/sources/src-1/update"]')).not.toBeNull();
  expect(folderImport.runFolderImport).not.toHaveBeenCalled();
});

it("syncs through the remembered handle and opens the preview", async () => {
  await renderButton();
  clickSync();
  await act(async () => {});
  expect(store.loadRememberedHandle).toHaveBeenCalledWith("src-1");
  expect(store.collectHandleFiles).toHaveBeenCalledWith(store.handle);
  expect(folderImport.runFolderImport).toHaveBeenCalledWith(
    expect.objectContaining({
      target: { kind: "existing", workspaceId: "ws-1", sourceId: "src-1", sourceName: "" },
    }),
  );
  expect(store.rememberFolderHandle).toHaveBeenCalledWith("src-1", store.handle, "notes");
  expect(navigation.push).toHaveBeenCalledWith(expect.stringContaining("snap-1"));
});

it("reports a sync failure in a status message instead of crashing", async () => {
  folderImport.runFolderImport.mockRejectedValueOnce(new Error("Uploading folder entries failed."));
  await renderButton();
  clickSync();
  await act(async () => {});
  const status = container.querySelector('[role="status"]');
  expect(status?.textContent).toContain("Uploading folder entries failed.");
  expect(navigation.push).not.toHaveBeenCalled();
});

it("syncs on the first click under Strict Mode with a cancellable session", async () => {
  folderImport.runFolderImport.mockImplementationOnce(async (...args: unknown[]) => {
    const input = args[0] as { assertAllowed: () => void; signal: AbortSignal };
    input.assertAllowed();
    expect(input.signal.aborted).toBe(false);
    return "snap-strict";
  });
  await act(async () => { root.render(<StrictMode><SyncNowButton workspaceId="ws-1" sourceId="src-1" /></StrictMode>); });
  clickSync();
  await act(async () => {});
  expect(navigation.push).toHaveBeenCalledWith("/w/ws-1/sources/imports/snap-strict");
});

it("cancels a remembered-folder import on pagehide without navigating", async () => {
  let signal: AbortSignal | undefined;
  folderImport.runFolderImport.mockImplementationOnce(async (...args: unknown[]) => {
    signal = (args[0] as { signal?: AbortSignal }).signal;
    return new Promise<string>((_resolve, reject) => {
      signal?.addEventListener("abort", () => reject(Object.assign(new Error("Cancelled"), { code: "IMPORT_CANCELLED" })));
    });
  });
  await renderButton();
  clickSync();
  await act(async () => {});
  await act(async () => { window.dispatchEvent(new Event("pagehide")); });
  expect(signal?.aborted).toBe(true);
  expect(navigation.push).not.toHaveBeenCalled();
});

it("passes the configured runtime asset limits to remembered-folder imports", async () => {
  const limits = { maxAssetFileBytes: 8, maxAssetTotalBytes: 16 };
  await act(async () => { root.render(<SyncNowButton workspaceId="ws-1" sourceId="src-1" limits={limits} />); });
  clickSync();
  await act(async () => {});
  expect(folderImport.runFolderImport).toHaveBeenCalledWith(expect.objectContaining({ limits }));
});

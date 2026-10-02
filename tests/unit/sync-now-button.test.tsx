// @vitest-environment jsdom
import { act } from "react";
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

function click(text: string): void {
  const button = [...container.querySelectorAll("button")].find((element) =>
    element.textContent?.includes(text),
  );
  if (!button) throw new Error(`Button "${text}" not found`);
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

it("shows Sync now with the remembered folder caption and a Forget action", async () => {
  await renderButton();
  expect(container.textContent).toContain("Sync now");
  expect(container.textContent).toContain("Last folder: notes");
  expect(container.textContent).toContain("Forget");
});

it("forgets the remembered folder and hides itself", async () => {
  await renderButton();
  click("Forget");
  await act(async () => {});
  expect(store.forgetRememberedFolder).toHaveBeenCalledWith("src-1");
  expect(container.innerHTML).toBe("");
});

it("asks to pick the folder again when the saved handle is unavailable", async () => {
  store.handle = null;
  await renderButton();
  click("Sync now");
  await act(async () => {});
  const status = container.querySelector('[role="status"]');
  expect(status?.textContent).toContain("Saved folder is unavailable - pick the folder again");
  expect(container.querySelector('a[href="/w/ws-1/sources/src-1/update"]')).not.toBeNull();
  expect(folderImport.runFolderImport).not.toHaveBeenCalled();
});

it("syncs through the remembered handle and opens the preview", async () => {
  await renderButton();
  click("Sync now");
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
  click("Sync now");
  await act(async () => {});
  const status = container.querySelector('[role="status"]');
  expect(status?.textContent).toContain("Uploading folder entries failed.");
  expect(navigation.push).not.toHaveBeenCalled();
});

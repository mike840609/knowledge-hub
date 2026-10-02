// @vitest-environment jsdom
import { act } from "react";
import { renderToString } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SourceSyncActions } from "@/components/sources/source-sync-actions";

const store = vi.hoisted(() => ({
  supported: true,
  meta: null as { rootName: string; lastSyncAt: string } | null,
  handle: Symbol("folder-handle") as unknown,
  isDirectoryPickerSupported: vi.fn(() => store.supported),
  getRememberedFolderMeta: vi.fn(() => store.meta),
  rememberFolderHandle: vi.fn(async () => {}),
  loadRememberedHandle: vi.fn(async () =>
    store.handle ? { handle: store.handle, rootName: "notes" } : null,
  ),
  forgetRememberedFolder: vi.fn(async () => {}),
  collectHandleFiles: vi.fn(async () => [] as File[]),
}));

vi.mock("@/components/imports/folder-handle-store", () => ({
  isDirectoryPickerSupported: store.isDirectoryPickerSupported,
  getRememberedFolderMeta: store.getRememberedFolderMeta,
  rememberFolderHandle: store.rememberFolderHandle,
  loadRememberedHandle: store.loadRememberedHandle,
  forgetRememberedFolder: store.forgetRememberedFolder,
  collectHandleFiles: store.collectHandleFiles,
}));

vi.mock("@/components/imports/folder-import-form", () => ({
  runFolderImport: vi.fn(async () => "snap-1"),
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

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  store.supported = true;
  store.meta = null;
  store.handle = Symbol("folder-handle") as unknown;
  auth.canImport = true;
  auth.confirmed = true;
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function renderActions() {
  await act(async () => {
    root.render(<SourceSyncActions workspaceId="ws-1" sourceId="src-1" />);
  });
}

function updateLink(): HTMLAnchorElement | null {
  return container.querySelector('a[href="/w/ws-1/sources/src-1/update"]');
}

it("renders Update from folder as primary when no folder is remembered", async () => {
  store.meta = null;
  await renderActions();
  const link = updateLink();
  expect(link?.textContent).toContain("Update from folder");
  expect(link?.className).toContain("bg-kh-primary");
  expect(link?.className).not.toContain("bg-transparent");
  expect(container.textContent).not.toContain("Sync now");
  expect(container.textContent).not.toContain("Last folder:");
});

it("orders caption before Sync now before Update when a folder is remembered (ghost Update, primary Sync)", async () => {
  store.meta = { rootName: "notes", lastSyncAt: "2026-10-02T00:00:00.000Z" };
  await renderActions();
  const link = updateLink();
  expect(link?.textContent).toContain("Update from folder");
  expect(link?.className).toContain("bg-transparent");
  expect(link?.className).not.toContain("bg-kh-primary");
  // Integration-style: the real SyncNowButton renders alongside the link.
  expect(container.textContent).toContain("Sync now");
  expect(container.textContent).toContain("Last folder: notes");
  const caption = container.querySelector("span.text-caption");
  expect(caption?.textContent).toContain("Last folder: notes");
  expect(caption?.className).toContain("text-kh-text-muted");
  const captionIndex = container.innerHTML.indexOf("Last folder: notes");
  const syncIndex = container.innerHTML.indexOf("Sync now");
  const updateIndex = container.innerHTML.indexOf("Update from folder");
  expect(captionIndex).toBeGreaterThanOrEqual(0);
  expect(syncIndex).toBeGreaterThanOrEqual(0);
  expect(updateIndex).toBeGreaterThanOrEqual(0);
  expect(captionIndex).toBeLessThan(syncIndex);
  expect(syncIndex).toBeLessThan(updateIndex);
});

it("renders the Sync now button with the primary variant when memory exists", async () => {
  store.meta = { rootName: "notes", lastSyncAt: "2026-10-02T00:00:00.000Z" };
  await renderActions();
  const syncButton = [...container.querySelectorAll("button")].find((element) =>
    element.textContent?.includes("Sync now"),
  );
  expect(syncButton?.className).toContain("bg-kh-primary");
  expect(syncButton?.className).not.toContain("border-kh-border-strong");
});

it("never renders the old secondary Update from folder", async () => {
  store.meta = { rootName: "notes", lastSyncAt: "2026-10-02T00:00:00.000Z" };
  await renderActions();
  expect(updateLink()?.className).not.toContain("border-kh-border-strong");
});

it("server render shows a primary Update link and reads no browser storage", () => {
  const html = renderToString(<SourceSyncActions workspaceId="ws-1" sourceId="src-1" />);
  expect(html).toContain("Update from folder");
  expect(html).toContain("bg-kh-primary");
  expect(html).not.toContain("Sync now");
  expect(store.isDirectoryPickerSupported).not.toHaveBeenCalled();
  expect(store.getRememberedFolderMeta).not.toHaveBeenCalled();
});

it("hides Update from folder without the import capability (gate stays with WorkspaceImportLink)", async () => {
  auth.canImport = false;
  await renderActions();
  expect(updateLink()).toBeNull();
});

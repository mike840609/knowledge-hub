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

it("renders Update from folder as an icon-only primary link when no folder is remembered", async () => {
  store.meta = null;
  await renderActions();
  const link = updateLink();
  expect(link?.getAttribute("aria-label")).toBe("Update from folder");
  expect(link?.textContent?.trim()).toBe("");
  expect(link?.querySelector("svg")).not.toBeNull();
  expect(link?.className).toContain("bg-kh-primary");
  expect(link?.className).not.toContain("bg-transparent");
  expect(link?.className).toContain("kh-icon-control");
  expect(container.querySelector('button[aria-label="Sync now"]')).toBeNull();
  expect(container.textContent).not.toContain("Last folder:");
});

it("orders Sync now before Update when a folder is remembered (ghost Update, primary Sync, no header caption)", async () => {
  store.meta = { rootName: "notes", lastSyncAt: "2026-10-02T00:00:00.000Z" };
  await renderActions();
  const link = updateLink();
  expect(link?.getAttribute("aria-label")).toBe("Update from folder");
  expect(link?.textContent?.trim()).toBe("");
  expect(link?.className).toContain("bg-transparent");
  expect(link?.className).not.toContain("bg-kh-primary");
  expect(link?.className).toContain("kh-icon-control");
  // Integration-style: the real SyncNowButton renders alongside the link.
  const syncButton = container.querySelector('button[aria-label="Sync now"]');
  expect(syncButton).not.toBeNull();
  expect(link).not.toBeNull();
  expect(syncButton?.textContent?.trim()).toBe("");
  expect(container.textContent).not.toContain("Last folder");
  if (syncButton && link) {
    expect(syncButton.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  } else {
    expect.unreachable("Sync now button and Update link both render when a folder is remembered");
  }
});

it("renders the Sync now button with the primary variant when memory exists", async () => {
  store.meta = { rootName: "notes", lastSyncAt: "2026-10-02T00:00:00.000Z" };
  await renderActions();
  const syncButton = container.querySelector('button[aria-label="Sync now"]');
  expect(syncButton?.className).toContain("bg-kh-primary");
  expect(syncButton?.className).not.toContain("border-kh-border-strong");
});

it("never renders the old secondary Update from folder", async () => {
  store.meta = { rootName: "notes", lastSyncAt: "2026-10-02T00:00:00.000Z" };
  await renderActions();
  expect(updateLink()?.className).not.toContain("border-kh-border-strong");
});

it("server render shows an icon-only primary Update link and reads no browser storage", () => {
  const html = renderToString(<SourceSyncActions workspaceId="ws-1" sourceId="src-1" />);
  expect(html).toContain('aria-label="Update from folder"');
  expect(html).toContain("bg-kh-primary");
  expect(html).not.toContain(">Update from folder<");
  expect(html).not.toContain("Sync now");
  expect(store.isDirectoryPickerSupported).not.toHaveBeenCalled();
  expect(store.getRememberedFolderMeta).not.toHaveBeenCalled();
});

it("reveals the Update tip on keyboard focus", async () => {
  store.meta = { rootName: "notes", lastSyncAt: "2026-10-02T00:00:00.000Z" };
  await renderActions();
  const link = updateLink();
  expect(link).not.toBeNull();
  await act(async () => {
    link?.focus();
  });
  expect(document.body.textContent).toContain("Update from folder - pick a different folder");
});

it("hides Update from folder without the import capability (gate stays with WorkspaceImportLink)", async () => {
  auth.canImport = false;
  await renderActions();
  expect(updateLink()).toBeNull();
});

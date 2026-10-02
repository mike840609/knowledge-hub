// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FolderImportForm } from "@/components/imports/folder-import-form";
import {
  collectHandleFiles,
  getRememberedFolderMeta,
  isDirectoryPickerSupported,
  rememberFolderHandle,
} from "@/components/imports/folder-handle-store";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
vi.mock("@/components/shell/use-workspace-authorization", () => ({
  requestWorkspaceAccessCheck: vi.fn(),
  useWorkspaceAuthorization: () => ({
    access: { actions: { canImport: true } },
    confirmed: true,
  }),
}));
vi.mock("@/components/imports/folder-handle-store", () => ({
  isDirectoryPickerSupported: vi.fn(),
  getRememberedFolderMeta: vi.fn(),
  rememberFolderHandle: vi.fn(),
  loadRememberedHandle: vi.fn(),
  forgetRememberedFolder: vi.fn(),
  collectHandleFiles: vi.fn(),
}));

const existingTarget = {
  kind: "existing",
  workspaceId: "w1",
  sourceId: "s1",
  sourceName: "Notes",
} as const;

function response(body: unknown, status = 200) {
  return Response.json(body, { status });
}

function stubImportSession(snapshotId = "snap-1") {
  return vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(response({ snapshotId }, 201))
    .mockResolvedValueOnce(response({}))
    .mockResolvedValue(response({}));
}

let root: Root;
let container: HTMLElement;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.mocked(getRememberedFolderMeta).mockReturnValue(null);
  vi.mocked(isDirectoryPickerSupported).mockReturnValue(false);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
  delete (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker;
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function renderForm(target: typeof existingTarget | { kind: "new"; workspaceId: string } = existingTarget) {
  act(() => {
    root.render(createElement(FolderImportForm, { target }));
  });
}

function chooseFolderButton(): HTMLButtonElement {
  const button = container.querySelector("button");
  if (!button || button.textContent !== "Choose folder") throw new Error("Choose folder button not found");
  return button as HTMLButtonElement;
}

async function clickChooseFolder() {
  await act(async () => {
    chooseFolderButton().click();
  });
}

describe("folder import directory picker", () => {
  it("collects picked files, remembers the handle after success, then navigates to the preview", async () => {
    vi.mocked(isDirectoryPickerSupported).mockReturnValue(true);
    vi.mocked(getRememberedFolderMeta).mockReturnValue({ rootName: "Notes", lastSyncAt: "2026-10-01T00:00:00.000Z" });
    const handle = { name: "Notes" };
    const showDirectoryPicker = vi.fn().mockResolvedValue(handle);
    Object.defineProperty(window, "showDirectoryPicker", { value: showDirectoryPicker, configurable: true });
    const files = [new File(["# hello"], "hello.md")];
    vi.mocked(collectHandleFiles).mockResolvedValue(files);
    vi.mocked(rememberFolderHandle).mockResolvedValue(undefined);
    const fetchMock = stubImportSession();
    vi.stubGlobal("fetch", fetchMock);

    renderForm();
    expect(container.textContent).toContain("Last synced folder: Notes");
    await clickChooseFolder();

    expect(showDirectoryPicker).toHaveBeenCalledWith({ mode: "read" });
    expect(collectHandleFiles).toHaveBeenCalledWith(handle);
    expect(rememberFolderHandle).toHaveBeenCalledWith("s1", handle, "Notes");
    expect(push).toHaveBeenCalledWith("/w/w1/sources/imports/snap-1");
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/sources/s1/source-imports",
      "/api/source-imports/snap-1/entries",
      "/api/source-imports/snap-1/finalize",
    ]);
  });

  it("stays IDLE when the user cancels the picker", async () => {
    vi.mocked(isDirectoryPickerSupported).mockReturnValue(true);
    const showDirectoryPicker = vi.fn().mockRejectedValue(new DOMException("cancelled", "AbortError"));
    Object.defineProperty(window, "showDirectoryPicker", { value: showDirectoryPicker, configurable: true });
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    renderForm();
    await clickChooseFolder();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(collectHandleFiles).not.toHaveBeenCalled();
    expect(container.textContent).toContain("No folder selected");
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it("falls back to the legacy input when the picker is unsupported", async () => {
    vi.mocked(isDirectoryPickerSupported).mockReturnValue(false);
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    renderForm();
    await clickChooseFolder();

    expect(clickSpy).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.querySelector("#import-folder")).not.toBeNull();
  });

  it("leaves the new-source flow on the legacy input even when the picker is supported", async () => {
    vi.mocked(isDirectoryPickerSupported).mockReturnValue(true);
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    renderForm({ kind: "new", workspaceId: "w1" });
    await clickChooseFolder();

    expect(clickSpy).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(collectHandleFiles).not.toHaveBeenCalled();
    expect(rememberFolderHandle).not.toHaveBeenCalled();
  });
});

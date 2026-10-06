// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FolderImportForm } from "@/components/imports/folder-import-form";
import { stashPendingHandle } from "@/components/imports/folder-handle-store";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const push = vi.fn();
vi.mock("@/lib/source-import-scope", () => ({ loadSourceImportScope: vi.fn(async () => ({ paths: [], configured: true, syncVersion: 1 })) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
vi.mock("@/components/shell/use-workspace-authorization", () => ({
  requestWorkspaceAccessCheck: vi.fn(),
  useWorkspaceAuthorization: () => ({ access: { actions: { canImport: true } }, confirmed: true }),
}));
vi.mock("@/components/imports/folder-handle-store", () => ({
  isDirectoryPickerSupported: vi.fn(() => false),
  getRememberedFolderMeta: vi.fn(() => null),
  rememberFolderHandle: vi.fn(),
  stashPendingHandle: vi.fn(),
  loadRememberedHandle: vi.fn(),
  forgetRememberedFolder: vi.fn(),
  collectHandleFiles: vi.fn(),
}));

const PUBLIC = path.join(process.cwd(), "public");
let root: Root;
let container: HTMLElement;
let sessionBodies: Array<{ sourceName: string; rootName: string; manifest: Array<{ relativePath: string }> }>;

/** Serves public/ from disk (except `missing`) and answers the import API. */
function stubNetwork(missing: string[] = []) {
  sessionBodies = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = decodeURI(String(input));
    if (url.startsWith("/sample-wiki/")) {
      if (missing.some((suffix) => url.endsWith(suffix))) return new Response("nope", { status: 404 });
      return new Response(readFileSync(path.join(PUBLIC, url.replace(/^\//, ""))));
    }
    if (url === "/api/workspaces/w1/source-imports") {
      sessionBodies.push(JSON.parse(String(init?.body)));
      return Response.json({ snapshotId: "snap-1" }, { status: 201 });
    }
    return Response.json({});
  }));
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function render(target: Parameters<typeof FolderImportForm>[0]["target"]) {
  act(() => { root.render(createElement(FolderImportForm, { target })); });
}
const newTarget = { kind: "new", workspaceId: "w1" } as const;
const existingTarget = { kind: "existing", workspaceId: "w1", sourceId: "s1", sourceName: "Notes" } as const;

function sampleButton(label: string): HTMLButtonElement {
  const button = [...container.querySelectorAll("#sample-wiki button")].find((b) => b.textContent === label);
  if (!button) throw new Error(`${label} button not found`);
  return button as HTMLButtonElement;
}
async function click(label: string) {
  await act(async () => { sampleButton(label).click(); });
  await act(async () => {});
}

describe("Try with a sample wiki", () => {
  it("is offered for a new source, as a labelled group with one button per language", () => {
    render(newTarget);
    const group = container.querySelector("#sample-wiki");
    expect(group?.getAttribute("role")).toBe("group");
    expect(group?.textContent).toContain("Try with a sample wiki");
    expect(group?.textContent).toContain("Not sure what a folder should look like? Import a ready-made one and see Preview before anything is saved.");
    expect([...group!.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["English", "繁體中文"]);
  });

  it("is not offered when re-syncing an existing source", () => {
    render(existingTarget);
    expect(container.querySelector("#sample-wiki")).toBeNull();
  });

  it.each([
    ["English", "Sample wiki", "sample-wiki-en"],
    ["繁體中文", "範例知識庫", "sample-wiki-zh-TW"],
  ])("%s goes through the folder-import flow named from the manifest, then opens Preview", async (label, sourceName, rootName) => {
    stubNetwork();
    render(newTarget);
    await click(label);
    expect(sessionBodies).toHaveLength(1);
    expect(sessionBodies[0].sourceName).toBe(sourceName);
    expect(sessionBodies[0].rootName).toBe(rootName);
    expect(sessionBodies[0].manifest).toHaveLength(7);
    expect(sessionBodies[0].manifest.map((entry) => entry.relativePath)).toContain("handbook/onboarding.md");
    expect(push).toHaveBeenCalledWith("/w/w1/sources/imports/snap-1");
    expect(stashPendingHandle).not.toHaveBeenCalled();
  });

  it("shows an inline alert and starts no import when a file cannot be fetched", async () => {
    stubNetwork(["concepts/sync.md"]);
    render(newTarget);
    await click("English");
    expect(container.querySelector("#sample-wiki [role=alert]")?.textContent).toContain("concepts/sync.md");
    expect(sessionBodies).toHaveLength(0);
    expect(push).not.toHaveBeenCalled();
  });

  it("disables the buttons while an import runs", async () => {
    stubNetwork();
    render(newTarget);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const base = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/workspaces/w1/source-imports") await gate;
      return base(input, init);
    }));
    await act(async () => { sampleButton("English").click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(sampleButton("English").disabled).toBe(true);
    expect(sampleButton("繁體中文").disabled).toBe(true);
    release();
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  });
});

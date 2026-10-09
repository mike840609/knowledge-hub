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

function chooseFolder(): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find((b) => b.textContent === "Choose folder");
  if (!button) throw new Error("Choose folder button not found");
  return button as HTMLButtonElement;
}

/** Polls a condition inside act() until it holds; fails loudly instead of sleeping a fixed time. */
async function waitFor(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for the condition.");
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
  }
}

/**
 * Wraps the stubbed fetch so the first request matching `match` pauses until
 * released. `reached` resolves the moment that request arrives.
 */
function gateRequest(match: (url: string) => boolean) {
  let release: () => void = () => {};
  const open = new Promise<void>((resolve) => { release = resolve; });
  let arrived: () => void = () => {};
  const reached = new Promise<void>((resolve) => { arrived = resolve; });
  let hits = 0;
  const base = globalThis.fetch;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (match(decodeURI(String(input)))) {
      hits += 1;
      arrived();
      await open;
    }
    return base(input, init);
  }));
  return { reached, release, count: () => hits };
}

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
    expect(group?.textContent).not.toContain("Not sure what a folder should look like?");
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

  it("re-enables the buttons and the picker after a failed load", async () => {
    stubNetwork(["concepts/sync.md"]);
    render(newTarget);
    await click("English");
    expect(sampleButton("English").disabled).toBe(false);
    expect(sampleButton("繁體中文").disabled).toBe(false);
    expect(chooseFolder().disabled).toBe(false);
  });

  it("locks the sample buttons and the picker while the sample is still being fetched, and a second click does nothing", async () => {
    stubNetwork();
    render(newTarget);
    const gate = gateRequest((url) => url === "/sample-wiki/manifest.json");
    await act(async () => { sampleButton("English").click(); });
    await gate.reached;
    expect(sampleButton("English").disabled).toBe(true);
    expect(sampleButton("繁體中文").disabled).toBe(true);
    expect(chooseFolder().disabled).toBe(true);
    await act(async () => { sampleButton("English").click(); sampleButton("繁體中文").click(); });
    expect(gate.count()).toBe(1);
    await act(async () => { gate.release(); });
    await waitFor(() => push.mock.calls.length > 0);
    expect(sessionBodies).toHaveLength(1);
  });

  it("keeps everything locked from the first click until the import request returns, with no enabled gap between", async () => {
    stubNetwork();
    render(newTarget);
    const gate = gateRequest((url) => url === "/api/workspaces/w1/source-imports");
    await act(async () => { sampleButton("English").click(); });
    await gate.reached;
    expect(sampleButton("English").disabled).toBe(true);
    expect(sampleButton("繁體中文").disabled).toBe(true);
    expect(chooseFolder().disabled).toBe(true);
    await act(async () => { gate.release(); });
    await waitFor(() => push.mock.calls.length > 0);
  });
});

// @vitest-environment jsdom
import { StrictMode, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FolderImportForm } from "@/components/imports/folder-import-form";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  accessCheck: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock("@/components/shell/use-workspace-authorization", () => ({
  requestWorkspaceAccessCheck: mocks.accessCheck,
  useWorkspaceAuthorization: () => ({
    confirmed: true,
    access: { actions: { canImport: true } },
  }),
}));

function response(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.push.mockReset();
  mocks.accessCheck.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("FolderImportForm lifecycle", () => {
  it.each(["cancel button", "pagehide"])("abandons the active import on %s without navigating to a preview", async (trigger) => {
    let uploadSignal: AbortSignal | undefined;
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({ snapshotId: "snapshot" }, 201))
      .mockImplementationOnce((_url, init) => new Promise<Response>((_resolve, reject) => {
        uploadSignal = init?.signal ?? undefined;
        uploadSignal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      }))
      .mockResolvedValueOnce(response({ abandoned: true }));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => { root.render(<FolderImportForm target={{ kind: "new", workspaceId: "workspace" }} />); });
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", { configurable: true, value: [new File(["# Hello"], "hello.md")] });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(uploadSignal).toBeDefined();
    await act(async () => {
      if (trigger === "pagehide") window.dispatchEvent(new Event("pagehide"));
      else {
        const cancel = [...container.querySelectorAll("button")].find((button) => button.textContent === "Cancel import");
        expect(cancel).toBeDefined();
        cancel!.click();
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(uploadSignal?.aborted).toBe(true);
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({ method: "DELETE", keepalive: true });
    expect(input.disabled).toBe(false);
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("starts the first folder import under React Strict Mode instead of reporting an access change", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({ snapshotId: "snapshot" }, 201))
      .mockResolvedValueOnce(response({}))
      .mockResolvedValueOnce(response({ snapshotId: "snapshot" }));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(
        <StrictMode>
          <FolderImportForm target={{ kind: "new", workspaceId: "workspace" }} />
        </StrictMode>,
      );
      await Promise.resolve();
    });

    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    const file = new File(["# Hello\n"], "hello.md", { type: "text/markdown" });
    Object.defineProperty(input!, "files", { configurable: true, value: [file] });

    await act(async () => {
      input!.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "/api/workspaces/workspace/source-imports",
      "/api/source-imports/snapshot/entries",
      "/api/source-imports/snapshot/finalize",
    ]);
    expect(container.textContent).not.toContain("WORKSPACE_ACCESS_CHANGED");
    expect(mocks.push).toHaveBeenCalledWith("/w/workspace/sources/imports/snapshot");
  });

  it("aborts the in-flight upload when the import form unmounts", async () => {
    let uploadSignal: AbortSignal | undefined;
    let releaseUpload: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({ snapshotId: "snapshot" }, 201))
      .mockImplementationOnce(async (_url, init) => {
        uploadSignal = init?.signal instanceof AbortSignal ? init.signal : undefined;
        return new Promise<Response>((resolve) => { releaseUpload = resolve; });
      })
      .mockResolvedValue(response({ abandoned: true }));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<FolderImportForm target={{ kind: "new", workspaceId: "workspace" }} />);
      await Promise.resolve();
    });

    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [new File(["# Hello\n"], "hello.md", { type: "text/markdown" })],
    });

    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
      for (let attempt = 0; attempt < 20 && releaseUpload === undefined; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    });
    expect(releaseUpload).toBeDefined();

    await act(async () => root.unmount());
    releaseUpload!(response({}));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(uploadSignal).toBeDefined();
    expect(uploadSignal?.aborted).toBe(true);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/entries"))).toHaveLength(1);
  });

});

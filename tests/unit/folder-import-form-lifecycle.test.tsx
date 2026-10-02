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
    Object.defineProperty(file, "webkitRelativePath", { configurable: true, value: "wiki/hello.md" });
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
});

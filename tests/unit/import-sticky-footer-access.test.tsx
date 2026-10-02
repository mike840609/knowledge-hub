// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImportStickyFooter } from "@/components/imports/import-sticky-footer";
import type { ImportPreview } from "@/modules/sources/application/reconcile-import-snapshot";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  accessCheck: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock("@/components/shell/use-workspace-authorization", () => ({
  requestWorkspaceAccessCheck: mocks.accessCheck,
  useWorkspaceAuthorization: () => ({
    confirmed: true,
    access: { actions: { canImport: true } },
  }),
}));

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

describe("ImportStickyFooter snapshot errors", () => {
  it("keeps a missing preview snapshot as an import error instead of pausing Workspace access", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ error: { code: "NOT_FOUND", message: "The requested resource was not found." } }, { status: 404 }),
    ));
    const preview = {
      snapshotId: "snapshot",
      sourceId: "source",
      state: "READY",
      expired: false,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      hasBlockers: false,
    } as unknown as ImportPreview;

    await act(async () => {
      root.render(<ImportStickyFooter workspaceId="workspace" preview={preview} />);
      await Promise.resolve();
    });
    const button = [...container.querySelectorAll("button")].find((node) => node.textContent === "Apply changes");
    expect(button).toBeDefined();

    await act(async () => {
      button!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(mocks.accessCheck).not.toHaveBeenCalled();
    expect(container.textContent).toContain("NOT_FOUND");
  });
});

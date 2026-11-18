// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import WorkspaceError from "@/app/w/[workspaceId]/error";
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useParams: () => ({ workspaceId: "team-workspace" }), useRouter: () => ({ refresh }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it("lets the reader retry or leave a failed page within the current workspace", async () => {
  const reset = vi.fn(), host = document.createElement("div");
  document.body.append(host); const root = createRoot(host);
  try {
    const error = Object.assign(new Error("private server details"), { digest: "digest-123" });
    await act(async () => root.render(<WorkspaceError error={error} reset={reset} />));
    expect(host.textContent).toContain("The server could not load this page");
    expect(host.textContent).toContain("digest-123");
    expect(host.textContent).not.toContain("private server details");
    expect(host.textContent).not.toContain("Check your connection");
    expect(host.querySelector("a")?.getAttribute("href")).toBe("/w/team-workspace/knowledge");
    await act(async () => host.querySelector("button")!.click());
    expect(refresh).toHaveBeenCalledOnce();
    expect(reset).toHaveBeenCalledOnce();
  } finally { await act(async () => root.unmount()); host.remove(); }
});

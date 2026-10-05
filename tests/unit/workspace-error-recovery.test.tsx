// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import WorkspaceError from "@/app/w/[workspaceId]/error";
vi.mock("next/navigation", () => ({ useParams: () => ({ workspaceId: "team-workspace" }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it("lets the reader retry or leave a failed page within the current workspace", async () => {
  const reset = vi.fn(), host = document.createElement("div");
  document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<WorkspaceError error={new Error("private server details")} reset={reset} />));
    expect(host.textContent).toContain("Check your connection");
    expect(host.textContent).not.toContain("private server details");
    expect(host.querySelector("a")?.getAttribute("href")).toBe("/w/team-workspace/knowledge");
    await act(async () => host.querySelector("button")!.click());
    expect(reset).toHaveBeenCalledOnce();
  } finally { await act(async () => root.unmount()); host.remove(); }
});

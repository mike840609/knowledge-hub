// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { AgentContextBuilder } from "@/components/knowledge/agent-context-builder";
vi.mock("@/components/shell/use-workspace-authorization", () => ({
  useWorkspaceAuthorization: () => ({ confirmed: true, access: { workspace: { id: "ws", lifecycleState: "ACTIVE" }, actions: { canImport: true, canWrite: true } } }),
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => vi.fn() }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.unstubAllGlobals());
it("prepares the selected saved content, offers manual clipboard fallback and invalidates changed selections", async () => {
  const fetch = vi.fn(async (url: string, init?: RequestInit) => { if (!url.endsWith("/agent-context") || init?.method !== "POST") throw new Error("Unexpected request"); return Response.json({ markdown: "# Saved context\nbody", bytes: 20, documentCount: 1 }); }); vi.stubGlobal("fetch", fetch);
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const click = async (name: string) => { const button = [...host.querySelectorAll("button")].find(b => b.textContent === name)!; await act(async () => { button.click(); }); };
  try {
    await act(async () => root.render(<AgentContextBuilder workspaceId="ws" documents={[{ documentId: "doc", sourceId: "s", title: "Guide", sourceName: "Wiki", sourcePath: "docs/guide.md" }]} />));
    const checkbox = host.querySelector<HTMLInputElement>("input[type=checkbox]")!;
    await act(async () => checkbox.click()); await click("Prepare context");
    expect(JSON.parse(fetch.mock.calls[0]?.[1]?.body as string)).toEqual({ documentIds: ["doc"] });
    const preview = host.querySelector<HTMLTextAreaElement>("textarea")!; expect(preview.value).toContain("Saved context");
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn(async () => { throw new Error("denied"); }) } });
    await click("Copy for Agent"); expect(host.querySelector('[role="alert"]')?.textContent).toContain("copy it manually"); expect(document.activeElement).toBe(preview); expect(preview.selectionEnd).toBe(preview.value.length);
    await act(async () => checkbox.click()); expect(host.querySelector("textarea")).toBeNull();
  } finally { await act(async () => root.unmount()); host.remove(); }
});

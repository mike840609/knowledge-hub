// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ReopenGuidanceMenuItem } from "@/components/knowledge/reopen-guidance-menu-item";
const mocks = vi.hoisted(() => ({ refresh: vi.fn(), toast: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => mocks.toast }));
vi.mock("@/components/ui/menu", () => ({ MenuItem: (props: React.ComponentProps<"button">) => <button {...props} /> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
async function open() {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<ReopenGuidanceMenuItem workspaceId="ws" />));
    await act(async () => host.querySelector("button")!.click());
  } finally { await act(async () => root.unmount()); host.remove(); }
}
it("reopens using the latest dismissal version without changing completion keys", async () => {
  const fetch = vi.fn(async (_url: string, init?: RequestInit) => Response.json(init?.method === "PUT" ? { version: 5 } : { value: { schemaVersion: 1, dismissed: true }, version: 4 }));
  vi.stubGlobal("fetch", fetch);
  await open();
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[1][0]).toBe("/api/workspaces/ws/onboarding");
  expect(JSON.parse(fetch.mock.calls[1][1]!.body as string)).toEqual({ value: { schemaVersion: 1, dismissed: false }, version: 4 });
  expect(mocks.refresh).toHaveBeenCalledOnce();
});
it("shows a retry message on a conflict and does not report success", async () => {
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => init?.method === "PUT" ? new Response(null, { status: 409 }) : Response.json({ value: { schemaVersion: 1, dismissed: true }, version: 4 })));
  await open();
  expect(mocks.refresh).not.toHaveBeenCalled();
  expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ tone: "danger", message: expect.stringContaining("Try Getting started again") }));
});
it("refreshes an already visible guide without another preference write", async () => {
  const fetch = vi.fn(async () => Response.json({ value: { schemaVersion: 1, dismissed: false }, version: 5 }));
  vi.stubGlobal("fetch", fetch); await open();
  expect(fetch).toHaveBeenCalledOnce(); expect(mocks.refresh).toHaveBeenCalledOnce();
});

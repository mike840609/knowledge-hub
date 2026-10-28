// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrimaryNav } from "@/components/shell/primary-nav";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({ usePathname: () => "/w/w1/home" }));
vi.mock("next/link", async () => {
  const { createElement: h } = await import("react");
  return {
    default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => h("a", { href, ...rest }, children),
  };
});
vi.mock("@/components/shell/use-workspace-authorization", () => ({
  useWorkspaceAuthorization: () => ({
    access: {
      workspace: { type: "PERSONAL" },
      actions: { canInspectSources: true, canSearch: true, canOpenSettings: true },
    },
  }),
}));
vi.mock("@/components/shell/use-inbox-unread", () => ({ useInboxUnread: () => 3 }));

let root: Root;
let container: HTMLElement;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});

describe("the primary rail's Inbox row", () => {
  it("puts the unread count in the accessible name at the full 176px width", () => {
    act(() => root.render(createElement(PrimaryNav, { workspaceId: "w1" })));
    const inbox = container.querySelector<HTMLAnchorElement>('a[aria-label="Inbox, 3 unread"]');
    expect(inbox).not.toBeNull();
    expect(inbox!.textContent).toContain("Inbox");
    expect(inbox!.textContent).toContain("3");
  });
});

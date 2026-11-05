// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrimaryNav } from "@/components/shell/primary-nav";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({ type: "PERSONAL", pathname: "/w/w1/home" }));
vi.mock("next/navigation", () => ({ usePathname: () => state.pathname }));
vi.mock("next/link", async () => {
  const { createElement: h } = await import("react");
  return {
    default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => h("a", { href, ...rest }, children),
  };
});
vi.mock("@/components/shell/use-workspace-authorization", () => ({
  useWorkspaceAuthorization: () => ({
    access: {
      workspace: { type: state.type },
      actions: { canInspectSources: true, canSearch: true, canOpenSettings: true },
    },
  }),
}));
vi.mock("@/components/shell/use-inbox-unread", () => ({ useInboxUnread: () => 0 }));

let root: Root;
let container: HTMLElement;
beforeEach(() => {
  state.type = "PERSONAL";
  state.pathname = "/w/w1/home";
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});

const tasksLink = () => container.querySelector<HTMLAnchorElement>('a[href="/w/w1/tasks"]');

describe("the primary rail's Tasks row (task knowledge export design, Amendment 3)", () => {
  it("is in My Space, labelled Tasks", () => {
    act(() => root.render(createElement(PrimaryNav, { workspaceId: "w1" })));
    expect(tasksLink()).not.toBeNull();
    expect(tasksLink()!.textContent).toContain("Tasks");
  });

  it("carries the Bot icon: results from coding agents, not a to-do list", () => {
    act(() => root.render(createElement(PrimaryNav, { workspaceId: "w1" })));
    expect(tasksLink()!.querySelector("svg.lucide-bot")).not.toBeNull();
  });

  it("is current on the list and on a task's own page", () => {
    for (const pathname of ["/w/w1/tasks", "/w/w1/tasks/t1", "/w/w1/tasks/setup"]) {
      state.pathname = pathname;
      act(() => root.render(createElement(PrimaryNav, { workspaceId: "w1", key: pathname })));
      expect(tasksLink()!.getAttribute("aria-current"), pathname).toBe("page");
    }
  });

  it("is not in a Team Workspace", () => {
    state.type = "TEAM";
    act(() => root.render(createElement(PrimaryNav, { workspaceId: "w1" })));
    expect(tasksLink()).toBeNull();
  });
});

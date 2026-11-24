// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrimaryNav } from "@/components/shell/primary-nav";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({ type: "PERSONAL", pathname: "/w/w1/home", canInspectSources: true }));
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
      actions: { canInspectSources: state.canInspectSources, canSearch: true, canOpenSettings: true },
    },
  }),
}));
let root: Root;
let container: HTMLElement;
beforeEach(() => {
  state.type = "PERSONAL";
  state.pathname = "/w/w1/home";
  state.canInspectSources = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});

const tasksLink = () => container.querySelector<HTMLAnchorElement>('a[href="/w/w1/tasks"]');
const insightsLink = () => container.querySelector<HTMLAnchorElement>('a[href="/w/w1/profile"]');

describe("secondary destinations in the primary rail", () => {
  it("keeps Tasks and Insights on the compact My Space rail", () => {
    act(() => root.render(createElement(PrimaryNav, { workspaceId: "w1", compact: true })));
    expect(tasksLink()?.getAttribute("aria-label")).toBe("Tasks");
    expect(insightsLink()?.getAttribute("aria-label")).toBe("Insights");
  });

  it("carries the Bot icon: results from coding agents, not a to-do list", () => {
    act(() => root.render(createElement(PrimaryNav, { workspaceId: "w1", compact: true })));
    expect(tasksLink()!.querySelector("svg.lucide-bot")).not.toBeNull();
  });

  it("is current on the list and on a task's own page", () => {
    for (const pathname of ["/w/w1/tasks", "/w/w1/tasks/t1", "/w/w1/tasks/setup"]) {
      state.pathname = pathname;
      act(() => root.render(createElement(PrimaryNav, { workspaceId: "w1", compact: true, key: pathname })));
      expect(tasksLink()!.getAttribute("aria-current"), pathname).toBe(pathname === "/w/w1/tasks" ? "page" : "location");
    }
  });

  it("is not in a Team Workspace", () => {
    state.type = "TEAM";
    act(() => root.render(createElement(PrimaryNav, { workspaceId: "w1", compact: true })));
    expect(tasksLink()).toBeNull();
  });

  it("keeps Home, but not Tasks or Insights, in the expanded personal rail", () => {
    state.pathname = "/w/w1/tasks";
    act(() => root.render(createElement(PrimaryNav, { workspaceId: "w1" })));
    expect(tasksLink()).toBeNull();
    expect(insightsLink()).toBeNull();
    expect(container.querySelector('a[href="/w/w1/home"]')?.hasAttribute("aria-current")).toBe(false);
  });

  it("gives a team the page switch without Home or Shares", () => {
    state.type = "TEAM";
    act(() => root.render(createElement(PrimaryNav, { workspaceId: "w1" })));
    const hrefs = [...container.querySelectorAll('nav[aria-label="Primary"] a')].map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["/w/w1/graph", "/w/w1/sources"]);
  });
});

describe("the expanded page switch", () => {
  const link = (href: string) => container.querySelector<HTMLAnchorElement>(`nav[aria-label="Primary"] a[href="${href}"]`)!;
  const render = () => act(() => root.render(createElement(PrimaryNav, { workspaceId: "w1", key: state.pathname })));

  it("lists Home, Graph, Sources and Shares in order, every one named", () => {
    render();
    const links = [...container.querySelectorAll<HTMLAnchorElement>('nav[aria-label="Primary"] a')];
    expect(links.map((a) => a.getAttribute("aria-label"))).toEqual(["Home", "Graph", "Sources", "Shares"]);
  });

  it("shows the name of the current page only", () => {
    state.pathname = "/w/w1/graph";
    render();
    expect(link("/w/w1/graph").getAttribute("aria-current")).toBe("page");
    const shown = (href: string) => link(href).querySelector<HTMLElement>("span")!.style.opacity === "1";
    expect(link("/w/w1/graph").textContent).toBe("Graph");
    expect(shown("/w/w1/graph")).toBe(true);
    for (const href of ["/w/w1/home", "/w/w1/sources", "/w/w1/shares"]) {
      expect(link(href).hasAttribute("aria-current"), href).toBe(false);
      expect(shown(href), href).toBe(false);
    }
  });

  it("marks a page below a destination as its location", () => {
    state.pathname = "/w/w1/sources/detail";
    render();
    expect(link("/w/w1/sources").getAttribute("aria-current")).toBe("location");
    expect(link("/w/w1/sources").textContent).toBe("Sources");
  });

  it("raises nothing on a page that is none of them, nor on a similarly prefixed route", () => {
    for (const pathname of ["/w/w1/knowledge/s/d", "/w/w1/sources-extra"]) {
      state.pathname = pathname;
      render();
      expect(container.querySelector('nav[aria-label="Primary"] [aria-current]'), pathname).toBeNull();
    }
  });

  it("follows the workspace's capabilities", () => {
    state.canInspectSources = false;
    render();
    expect(container.querySelector('a[href="/w/w1/sources"]')).toBeNull();
  });
});

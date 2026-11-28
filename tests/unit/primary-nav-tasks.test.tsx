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

const agentsLink = () => container.querySelector<HTMLAnchorElement>('a[href="/w/w1/agents"]');
const insightsLink = () => container.querySelector<HTMLAnchorElement>('a[href="/w/w1/profile"]');

describe("secondary destinations in the primary rail", () => {
  it("keeps Agents and Insights on the compact My Space rail, and no separate Tasks", () => {
    act(() => root.render(createElement(PrimaryNav, { workspaceId: "w1", compact: true })));
    expect(agentsLink()?.getAttribute("aria-label")).toBe("Agents");
    expect(container.querySelector('a[href="/w/w1/tasks"]')).toBeNull();
    expect(insightsLink()?.getAttribute("aria-label")).toBe("Insights");
  });

  it("carries the Bot icon", () => {
    act(() => root.render(createElement(PrimaryNav, { workspaceId: "w1", compact: true })));
    expect(agentsLink()!.querySelector("svg.lucide-bot")).not.toBeNull();
  });

  it("is current on the Agents page", () => {
    state.pathname = "/w/w1/agents";
    act(() => root.render(createElement(PrimaryNav, { workspaceId: "w1", compact: true })));
    expect(agentsLink()!.getAttribute("aria-current")).toBe("page");
  });

  it("is not in a Team Workspace", () => {
    state.type = "TEAM";
    act(() => root.render(createElement(PrimaryNav, { workspaceId: "w1", compact: true })));
    expect(agentsLink()).toBeNull();
  });

  it("keeps Home and Agents, but not Insights, in the expanded personal rail", () => {
    state.pathname = "/w/w1/tasks";
    act(() => root.render(createElement(PrimaryNav, { workspaceId: "w1" })));
    expect(agentsLink()?.hasAttribute("aria-current")).toBe(false);
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

  it("lists Home, Graph, Sources, Shares and Agents in order, every one named", () => {
    render();
    const links = [...container.querySelectorAll<HTMLAnchorElement>('nav[aria-label="Primary"] a')];
    expect(links.map((a) => a.getAttribute("aria-label"))).toEqual(["Home", "Graph", "Sources", "Shares", "Agents"]);
  });

  it("shows the name of the current page only", () => {
    state.pathname = "/w/w1/graph";
    render();
    expect(link("/w/w1/graph").getAttribute("aria-current")).toBe("page");
    const shown = (href: string) => link(href).querySelector<HTMLElement>("span")!.style.opacity === "1";
    expect(link("/w/w1/graph").textContent).toBe("Graph");
    expect(shown("/w/w1/graph")).toBe(true);
    for (const href of ["/w/w1/home", "/w/w1/sources", "/w/w1/shares", "/w/w1/agents"]) {
      expect(link(href).hasAttribute("aria-current"), href).toBe(false);
      expect(shown(href), href).toBe(false);
    }
  });

  it("raises the clicked page at once and leaves aria-current on the page still showing", () => {
    const nav = () => act(() => root.render(createElement(PrimaryNav, { workspaceId: "w1" })));
    const raised = (href: string) => link(href).querySelector<HTMLElement>("span")!.style.opacity === "1";
    container.addEventListener("click", (event) => event.preventDefault());
    nav();
    act(() => link("/w/w1/graph").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })));
    expect(raised("/w/w1/graph")).toBe(true);
    expect(raised("/w/w1/home")).toBe(false);
    expect(link("/w/w1/home").getAttribute("aria-current")).toBe("page");
    expect(link("/w/w1/graph").hasAttribute("aria-current")).toBe(false);
    // A modified click opens elsewhere and moves nothing here.
    act(() => link("/w/w1/sources").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, metaKey: true })));
    expect(raised("/w/w1/sources")).toBe(false);
    // Once the route commits, the real page decides again.
    state.pathname = "/w/w1/shares";
    nav();
    expect(raised("/w/w1/shares")).toBe(true);
    expect(raised("/w/w1/graph")).toBe(false);
  });

  it("drops the raise once the route has moved, even when Back returns to the page it was clicked on", () => {
    const nav = () => act(() => root.render(createElement(PrimaryNav, { workspaceId: "w1" })));
    const raised = (href: string) => link(href).querySelector<HTMLElement>("span")!.style.opacity === "1";
    container.addEventListener("click", (event) => event.preventDefault());
    nav();
    act(() => link("/w/w1/graph").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })));
    state.pathname = "/w/w1/graph";
    nav();
    state.pathname = "/w/w1/home";
    nav();
    expect(raised("/w/w1/home")).toBe(true);
    expect(raised("/w/w1/graph")).toBe(false);
  });

  it("takes the raise back when the reader clicks the page still showing", () => {
    const nav = () => act(() => root.render(createElement(PrimaryNav, { workspaceId: "w1" })));
    const raised = (href: string) => link(href).querySelector<HTMLElement>("span")!.style.opacity === "1";
    const click = (href: string) => act(() => link(href).dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })));
    container.addEventListener("click", (event) => event.preventDefault());
    nav();
    click("/w/w1/graph");
    click("/w/w1/home");
    expect(raised("/w/w1/home")).toBe(true);
    expect(raised("/w/w1/graph")).toBe(false);
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

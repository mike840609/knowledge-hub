// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { DocumentBreadcrumb } from "@/components/knowledge/document-breadcrumb";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => { document.body.innerHTML = ""; });

async function mount(node: React.ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(node));
  return { host, root };
}

const SEGMENTS = [
  { label: "Sample wiki", href: "/w/w/knowledge/s" },
  { label: "handbook", href: "/w/w/knowledge/s?folder=h" },
  { label: "people", href: "/w/w/knowledge/s?folder=p" },
  { label: "Leave policy" },
];

it("marks the page itself as the current item and gives each level a role", async () => {
  const { host, root } = await mount(<DocumentBreadcrumb segments={SEGMENTS} />);
  expect(host.querySelector("[aria-current=page]")?.textContent).toBe("Leave policy");
  expect(Array.from(host.querySelectorAll("li[data-crumb]")).map((item) => item.getAttribute("data-crumb"))).toEqual(["first", "collapsed", "middle", "middle", "last"]);
  await act(async () => root.unmount());
});

it("folds the levels between the first and the page into a menu of links", async () => {
  const { host, root } = await mount(<DocumentBreadcrumb segments={SEGMENTS} />);
  const trigger = host.querySelector<HTMLButtonElement>("[data-crumb=collapsed] button")!;
  expect(trigger.getAttribute("aria-label")).toBe("Show 2 more levels of the path");
  await act(async () => trigger.click());
  const items = Array.from(document.body.querySelectorAll("[role=menuitem]"));
  expect(items.map((item) => item.textContent)).toEqual(["handbook", "people"]);
  expect(items.map((item) => item.getAttribute("href"))).toEqual(["/w/w/knowledge/s?folder=h", "/w/w/knowledge/s?folder=p"]);
  await act(async () => root.unmount());
});

it("has nothing to fold for a page directly under its source", async () => {
  const { host, root } = await mount(<DocumentBreadcrumb segments={[SEGMENTS[0]!, { label: "Leave policy" }]} />);
  expect(host.querySelector("[data-crumb=collapsed]")).toBeNull();
  await act(async () => root.unmount());
});

// Review round 5: the first level gives way to the page's name, so the name itself never takes the first level's
// narrow-pane rule (it would start from nothing and sit at 3ch); a two-level path's first level does take it.
it("gives way at the first level only when the first level is not the page itself", async () => {
  const only = await mount(<DocumentBreadcrumb segments={[{ label: "Onboarding guide" }]} />);
  expect(only.host.querySelector("li")!.className).not.toContain("kh-crumb-first");
  await act(async () => only.root.unmount());
  const two = await mount(<DocumentBreadcrumb segments={[{ label: "Notes", href: "/w/w/knowledge/s" }, { label: "Onboarding guide" }]} />);
  expect(Array.from(two.host.querySelectorAll("li")).map((item) => item.className.includes("kh-crumb-first"))).toEqual([true, false]);
  await act(async () => two.root.unmount());
});

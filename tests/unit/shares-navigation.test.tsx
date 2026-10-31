// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useSearchParams } from "next/navigation";
import { SharesNavigation, parseSharesTab } from "@/components/knowledge/shares-navigation";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({ pending: false }));

vi.mock("next/navigation", () => ({ useSearchParams: vi.fn() }));
vi.mock("next/link", () => ({
  default: ({ href, children, prefetch: _prefetch, onClick, ...rest }: { href: string; children: ReactNode; prefetch?: boolean; onClick?: (event: MouseEvent<HTMLAnchorElement>) => void } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href">) =>
    <a href={href} onClick={event => { event.preventDefault(); onClick?.(event); }} {...rest}>{children}</a>,
  useLinkStatus: () => ({ pending: state.pending }),
}));

let host: HTMLDivElement, root: Root;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.clearAllMocks(); state.pending = false; });

async function mount(tab: string | null, unread = 0) {
  vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams(tab ? `tab=${tab}` : "") as unknown as ReturnType<typeof useSearchParams>);
  await act(async () => root.render(<SharesNavigation workspaceId="ws" discussionsUnread={unread} />));
  const link = (name: string) => [...host.querySelectorAll("a")].find(node => node.textContent?.startsWith(name))!;
  return { mine: link("My shares"), saved: link("Saved shares"), discussions: link("Discussions") };
}

it("falls back to My shares for the default and any unknown value", () => {
  expect(parseSharesTab(null)).toBe("mine");
  expect(parseSharesTab("saved")).toBe("saved");
  expect(parseSharesTab("discussions")).toBe("discussions");
  expect(parseSharesTab("something-else")).toBe("mine");
});

it("marks the tab named by the URL and shows the unread count", async () => {
  const tabs = await mount("saved", 30);
  expect(tabs.saved.getAttribute("aria-current")).toBe("page");
  expect(tabs.mine.getAttribute("aria-current")).toBeNull();
  expect(tabs.discussions.textContent).toContain("30");
  expect(tabs.discussions.querySelector('[aria-label="30 unread"]')).not.toBeNull();
});

it("moves the current tab on a plain click, and not on a modified click", async () => {
  const tabs = await mount(null);
  await act(async () => tabs.saved.click());
  expect(tabs.saved.getAttribute("aria-current")).toBe("page");
  expect(tabs.mine.getAttribute("aria-current")).toBeNull();

  await act(async () => {
    tabs.mine.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, metaKey: true, button: 0 }));
  });
  expect(tabs.saved.getAttribute("aria-current")).toBe("page");
});

it("marks the label while a navigation is pending", async () => {
  state.pending = true;
  await mount(null);
  expect(host.querySelector(".opacity-60")).not.toBeNull();
});

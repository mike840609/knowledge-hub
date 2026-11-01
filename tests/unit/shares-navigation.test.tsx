// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useSearchParams } from "next/navigation";
import { SharesNavigation, parseSharesTab } from "@/components/knowledge/shares-navigation";
import { LiveSearch } from "@/components/search/live-search-submit";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({ pending: false, pendingByHref: {} as Record<string, boolean>, refresh: vi.fn(), replace: vi.fn() }));

vi.mock("next/navigation", () => ({ useSearchParams: vi.fn(), useRouter: () => ({ refresh: state.refresh, replace: state.replace }) }));
vi.mock("next/link", async () => {
  const React = await import("react");
  const Href = React.createContext("");
  const Provider = Href.Provider;
  return {
    default: ({ href, children, prefetch, onClick, ...rest }: { href: string; children: ReactNode; prefetch?: boolean; onClick?: (event: MouseEvent<HTMLAnchorElement>) => void } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href">) =>
      <Provider value={href}><a href={href} data-prefetch={prefetch ? "true" : undefined} onClick={event => { onClick?.(event); event.preventDefault(); }} {...rest}>{children}</a></Provider>,
    useLinkStatus: () => ({ pending: state.pending || !!state.pendingByHref[React.useContext(Href)] }),
  };
});

let host: HTMLDivElement, root: Root;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.clearAllMocks(); state.pending = false; state.pendingByHref = {}; });

async function mount(tab: string | null, unread = 0) {
  vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams(tab ? `tab=${tab}` : "") as unknown as ReturnType<typeof useSearchParams>);
  const discussionsBadge = unread > 0 ? <span aria-label={`${unread} unread`}>{unread}</span> : null;
  await act(async () => root.render(<SharesNavigation workspaceId="ws" discussionsBadge={discussionsBadge} />));
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

it("preserves an in-flight optimistic tab when the deferred badge arrives", async () => {
  const tabs = await mount(null);
  await act(async () => tabs.saved.click());
  await act(async () => root.render(<SharesNavigation workspaceId="ws" discussionsBadge={<span aria-label="3 unread">3</span>} />));
  expect(tabs.saved.getAttribute("aria-current")).toBe("page");
  expect(tabs.discussions.textContent).toContain("3");
});

it("ignores an old link settling after a newer tab click", async () => {
  const savedHref = "/w/ws/shares?tab=saved", discussionsHref = "/w/ws/shares?tab=discussions";
  const tabs = await mount(null);
  state.pendingByHref[savedHref] = true;
  await act(async () => tabs.saved.click());
  await mount(null);
  state.pendingByHref[discussionsHref] = true;
  await act(async () => tabs.discussions.click());
  await mount(null);
  state.pendingByHref[savedHref] = false;
  await mount(null);
  expect(tabs.discussions.getAttribute("aria-current")).toBe("page");
  expect(tabs.mine.getAttribute("aria-current")).toBeNull();
});

it("keeps the newest tab selected when an older route commits first", async () => {
  const tabs = await mount(null);
  const savedHref = "/w/ws/shares?tab=saved";
  const discussionsHref = "/w/ws/shares?tab=discussions";
  state.pendingByHref[savedHref] = true;
  await act(async () => tabs.saved.click());
  await mount(null);
  state.pendingByHref[discussionsHref] = true;
  await act(async () => tabs.discussions.click());
  await mount(null);
  await mount("saved"); // The older transition commits out of order.
  expect(tabs.discussions.getAttribute("aria-current")).toBe("page");
  state.pendingByHref[savedHref] = false;
  await mount("saved");
  expect(tabs.discussions.getAttribute("aria-current")).toBe("page");
  await mount("discussions"); // The most recent destination wins.
  expect(tabs.discussions.getAttribute("aria-current")).toBe("page");
  state.pendingByHref[discussionsHref] = false;
  await mount("discussions");
  expect(tabs.saved.getAttribute("aria-current")).toBeNull();
});

it.each(["saved", "discussions"] as const)("cancels a queued search before switching to %s", async tab => {
  vi.useFakeTimers();
  vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams() as unknown as ReturnType<typeof useSearchParams>);
  await act(async () => root.render(
    <div className="kh-page-wide">
      <SharesNavigation workspaceId="ws" />
      <form action="/w/ws/shares">
        <input name="q" defaultValue="" />
        <LiveSearch />
      </form>
    </div>,
  ));
  const field = host.querySelector<HTMLInputElement>('input[name="q"]')!;
  field.value = "pending search";
  await act(async () => field.dispatchEvent(new Event("input", { bubbles: true })));
  const destination = host.querySelector<HTMLAnchorElement>(`a[href="/w/ws/shares?tab=${tab}"]`)!;
  await act(async () => destination.click());
  expect(destination.getAttribute("aria-current")).toBe("page");

  await act(async () => vi.advanceTimersByTime(300));
  expect(state.replace).not.toHaveBeenCalled();
});

it("does not cancel the current search on a modified tab click", async () => {
  vi.useFakeTimers();
  vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams() as unknown as ReturnType<typeof useSearchParams>);
  await act(async () => root.render(
    <div className="kh-page-wide">
      <SharesNavigation workspaceId="ws" />
      <form action="/w/ws/shares">
        <input name="q" defaultValue="" />
        <LiveSearch />
      </form>
    </div>,
  ));
  const field = host.querySelector<HTMLInputElement>('input[name="q"]')!;
  field.value = "keep searching";
  await act(async () => field.dispatchEvent(new Event("input", { bubbles: true })));
  const saved = host.querySelector<HTMLAnchorElement>('a[href="/w/ws/shares?tab=saved"]')!;
  await act(async () => saved.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, metaKey: true, button: 0 })));

  await act(async () => vi.advanceTimersByTime(300));
  expect(state.replace).toHaveBeenCalledOnce();
  expect(state.replace).toHaveBeenCalledWith("/w/ws/shares?q=keep+searching", { scroll: false });
});

it("refreshes the server badge after Inbox notification changes", async () => {
  await mount(null);
  await act(async () => window.dispatchEvent(new Event("kh:notification-changed")));
  expect(state.refresh).toHaveBeenCalledTimes(1);
});

it("reverts the optimistic tab when a navigation settles without changing the URL", async () => {
  state.pending = true;
  const tabs = await mount(null);
  await act(async () => tabs.saved.click());
  expect(tabs.saved.getAttribute("aria-current")).toBe("page");
  state.pending = false;
  await act(async () => root.render(<SharesNavigation workspaceId="ws" />));
  expect([...host.querySelectorAll("a")].find(node => node.textContent?.startsWith("My shares"))?.getAttribute("aria-current")).toBe("page");
  expect([...host.querySelectorAll("a")].find(node => node.textContent?.startsWith("Saved shares"))?.getAttribute("aria-current")).toBeNull();
});

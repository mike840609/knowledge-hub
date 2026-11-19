// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InboxHeaderLink, PrimaryNav } from "@/components/shell/primary-nav";
import { useInboxUnread } from "@/components/shell/use-inbox-unread";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const reviewRequest = vi.hoisted(() => vi.fn<() => Promise<{ count: number }>>());
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
vi.mock("@/components/knowledge/review-thread-list", () => ({ reviewRequest }));

function LiveInboxHeaderLink() {
  return <InboxHeaderLink workspaceId="w1" unread={useInboxUnread(true)} />;
}

let root: Root;
let container: HTMLElement;
beforeEach(() => {
  reviewRequest.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});

it("keeps the newest unread count when an older count arrives after a mark-read refresh", async () => {
  let releaseOlderCount!: (result: { count: number }) => void;
  const olderCount = new Promise<{ count: number }>((resolve) => { releaseOlderCount = resolve; });
  reviewRequest.mockResolvedValueOnce({ count: 1 }).mockReturnValueOnce(olderCount).mockResolvedValueOnce({ count: 0 });

  await act(async () => root.render(<LiveInboxHeaderLink />));
  const inbox = container.querySelector('a[href="/w/w1/inbox"]');
  expect(inbox?.getAttribute("aria-label")).toBe("Inbox, 1 unread");

  await act(async () => { window.dispatchEvent(new Event("focus")); });
  await act(async () => { window.dispatchEvent(new Event("kh:notification-changed")); });
  expect(inbox?.getAttribute("aria-label")).toBe("Inbox");

  await act(async () => releaseOlderCount({ count: 1 }));
  expect(inbox?.getAttribute("aria-label")).toBe("Inbox");
});

describe("the primary navigation's Inbox row", () => {
  it("lets the expanded desktop header own the Inbox entry", () => {
    act(() => root.render(createElement(PrimaryNav, { workspaceId: "w1" })));
    expect(container.querySelector('a[href="/w/w1/inbox"]')).toBeNull();
  });

  it("puts the unread count in the drawer row's label and badge", () => {
    act(() => root.render(<PrimaryNav workspaceId="w1" inboxUnread={3} />));
    const inbox = container.querySelector<HTMLAnchorElement>('a[aria-label="Inbox, 3 unread"]');
    expect(inbox).not.toBeNull();
    expect(inbox!.textContent).toContain("Inbox");
    expect(inbox!.textContent).toContain("3");
  });
});

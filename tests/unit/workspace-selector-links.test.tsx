// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push }) }));
vi.mock("next/link", () => ({ default: ({ children, onClick, prefetch, ...props }: React.ComponentProps<"a"> & { prefetch?: boolean }) => <a {...props} data-prefetch={String(prefetch)} onClick={(event) => { onClick?.(event); event.preventDefault(); }}>{children}</a> }));
vi.mock("@/components/ui/tooltip", () => ({ Tooltip: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@/components/shell/use-workspace-authorization", () => ({
  useWorkspaceAuthorization: () => ({
    confirmed: true,
    refresh: () => {},
    access: { actions: {} },
    navigation: {
      teamsOpen: true,
      canCreateTeam: false,
      items: [
        { id: "me", type: "PERSONAL", name: "Me", lifecycleState: "ACTIVE" },
        { id: "team", type: "TEAM", name: "Team", lifecycleState: "ACTIVE" },
      ],
    },
  }),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { WorkspaceSelector } = await import("@/components/shell/workspace-selector");

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => { await cleanup?.(); document.body.innerHTML = ""; });

async function click(element: Element | null) {
  expect(element).not.toBeNull();
  await act(async () => {
    element!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    element!.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
    element!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

// A workspace in the switcher is a place, so it is a link: Cmd/Ctrl-click, middle-click and
// "open in new tab" need an href, which `router.push` in an onClick never gave them.
it("renders each workspace as a menu item link to that workspace's knowledge", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  cleanup = async () => { await act(async () => root.unmount()); host.remove(); };
  await act(async () => root.render(<WorkspaceSelector workspaceId="me" />));

  await click(document.querySelector('button[aria-label="Workspace: My Space"]'));
  const links = [...document.querySelectorAll('[role="menu"] a[role="menuitem"]')];
  expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
    ["My Space", "/w/me/knowledge"],
    ["Team", "/w/team/knowledge"],
  ]);
  expect(links.map((link) => link.getAttribute("aria-current"))).toEqual(["location", null]);
  expect(links.map((link) => link.getAttribute("data-prefetch"))).toEqual(["false", "false"]);

  // Following the link closes the menu, and navigation is the anchor's, not router.push.
  await click(links[1]);
  expect(push).not.toHaveBeenCalled();
  expect(document.querySelector('[role="menu"]')).toBeNull();
});

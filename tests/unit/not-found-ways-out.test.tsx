// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }), useParams: () => ({ workspaceId: "ws 1" }) }));
import { RedirectCountdown } from "@/components/shell/redirect-countdown";
import { WorkspaceNotFound } from "@/components/shell/workspace-not-found";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers(); replace.mockReset();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it("counts down three seconds, then replaces the dead address with home", () => {
  act(() => root.render(<RedirectCountdown href="/" label="your workspace" />));
  expect(container.textContent).toContain("in 3 seconds");
  act(() => vi.advanceTimersByTime(1000));
  act(() => vi.advanceTimersByTime(1000));
  expect(container.textContent).toContain("in 1 second…");
  expect(replace).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(1000));
  expect(replace.mock.calls).toEqual([["/"]]);
});

it("does not navigate once the page is left before the countdown ends", () => {
  act(() => root.render(<RedirectCountdown href="/" label="your workspace" />));
  act(() => vi.advanceTimersByTime(1500));
  act(() => root.unmount()); root = createRoot(container);
  act(() => vi.advanceTimersByTime(5000));
  expect(replace).not.toHaveBeenCalled();
});

it("offers this workspace and the reader's own, without redirecting", () => {
  act(() => root.render(<WorkspaceNotFound />));
  const links = [...container.querySelectorAll("a")].map(a => [a.textContent, a.getAttribute("href")]);
  expect(links).toEqual([["Back to this workspace", "/w/ws%201/knowledge"], ["Go to my workspace", "/"]]);
  act(() => vi.advanceTimersByTime(10000));
  expect(replace).not.toHaveBeenCalled();
});

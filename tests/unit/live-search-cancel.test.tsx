// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { cancelPendingLiveSearch, LiveSearch } from "@/components/search/live-search-submit";

const state = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: state.replace }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { vi.useRealTimers(); state.replace.mockReset(); });

it("cancels a debounced search when the user follows a pagination link", async () => {
  vi.useFakeTimers();
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<form action="/w/ws/shares"><input name="q" defaultValue="old" /><LiveSearch /></form>));
    const input = host.querySelector("input")!;
    input.value = "new";
    await act(async () => input.dispatchEvent(new Event("input", { bubbles: true })));
    cancelPendingLiveSearch(host.querySelector("form"));
    await act(async () => vi.advanceTimersByTime(300));
    expect(state.replace).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount()); host.remove();
  }
});

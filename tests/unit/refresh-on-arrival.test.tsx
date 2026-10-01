// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RefreshOnArrival, refreshOnArrival, refreshOnArrivalElsewhere } from "@/components/shell/refresh-on-arrival";

const navigation = vi.hoisted(() => ({ pathname: "", router: { refresh: vi.fn() } }));
vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => navigation.router,
}));

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  navigation.router.refresh.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(pathname: string, committedPage: string) {
  navigation.pathname = pathname;
  await act(async () => root.render(<RefreshOnArrival pathname={committedPage} />));
}

it("waits for the pushed document to commit before refreshing its shared tree", async () => {
  refreshOnArrival("/w/space/knowledge/notes/restored");
  await render("/w/space/knowledge/notes/restored", "/w/space/knowledge/notes/previous");
  expect(navigation.router.refresh).not.toHaveBeenCalled();
  await render("/w/space/knowledge/notes/restored", "/w/space/knowledge/notes/restored");
  expect(navigation.router.refresh).toHaveBeenCalledTimes(1);
  // Remount so the effect runs again: a consumed arrival must not refresh twice.
  await act(async () => root.unmount());
  root = createRoot(container);
  await render("/w/space/knowledge/notes/restored", "/w/space/knowledge/notes/restored");
  expect(navigation.router.refresh).toHaveBeenCalledTimes(1);
});

it("does not refresh an archive's intermediate redirect or the previous document", async () => {
  window.history.replaceState(null, "", "/w/space/knowledge/notes/archived");
  refreshOnArrivalElsewhere();
  await render("/w/space/knowledge/notes", "/w/space/knowledge/notes/archived");
  await render("/w/space/knowledge/notes/next", "/w/space/knowledge/notes/archived");
  expect(navigation.router.refresh).not.toHaveBeenCalled();
  await render("/w/space/knowledge/notes/next", "/w/space/knowledge/notes/next");
  expect(navigation.router.refresh).toHaveBeenCalledTimes(1);
});

it("refreshes the committed empty source after archiving its last document", async () => {
  window.history.replaceState(null, "", "/w/space/knowledge/notes/last");
  refreshOnArrivalElsewhere();
  await render("/w/space/knowledge/notes", "/w/space/knowledge/notes");
  expect(navigation.router.refresh).toHaveBeenCalledTimes(1);
});

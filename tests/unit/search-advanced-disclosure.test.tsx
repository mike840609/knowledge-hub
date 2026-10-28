// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SearchForm } from "@/components/search/search-form";

const navigation = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: navigation.replace }) }));

const props = {
  workspaceId: "ws", q: "needle", scope: "workspace" as const,
  sourceId: "src-1", includeArchived: true,
  sources: [{ id: "src-1", name: "Runbooks" } as never],
  filters: { path: "docs/runbooks", from: "2026-01-01", to: "2026-02-01", sort: "newest" as const, offset: "480" },
};
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  navigation.replace.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("advanced search disclosure", () => {
  // Catches server markup forcing active searches open (including before hydration / without JS).
  it("starts collapsed with applied filters visible and successful GET controls intact", () => {
    host.innerHTML = renderToStaticMarkup(<SearchForm {...props} />);
    expect(host.querySelector("details")!.open).toBe(false);
    const chips = host.querySelector('[aria-label="Active search filters"]')!;
    expect(chips.closest("details")).toBeNull();
    expect(chips.textContent).toContain("Path: docs/runbooks");
    const form = host.querySelector("form")!;
    expect(form.getAttribute("action")).toBe("/w/ws/search");
    expect(form.method).toBe("get");
    expect(Object.fromEntries(new FormData(form))).toEqual({
      q: "needle", path: "docs/runbooks", from: "2026-01-01", to: "2026-02-01",
      sort: "newest", offset: "480", scope: "workspace", source: "src-1", archived: "1",
    });
    host.replaceChildren();
  });

  // Catches disclosure state being reset by a live-search result / active chip update.
  it("lets the reader open and close the filters across URL updates", async () => {
    await act(async () => root.render(<SearchForm {...props} />));
    const disclosure = host.querySelector("details")!;
    const summary = host.querySelector("summary")!;
    expect(disclosure.open).toBe(false);
    await act(async () => summary.click());
    expect(disclosure.open).toBe(true);
    await act(async () => root.render(<SearchForm {...props} filters={{ ...props.filters, path: "guides" }} />));
    expect(disclosure.open).toBe(true);
    expect(host.querySelector('[aria-label="Active search filters"]')!.textContent).toContain("Path: guides");
    await act(async () => summary.click());
    expect(disclosure.open).toBe(false);
    await act(async () => root.render(<SearchForm {...props} filters={{ ...props.filters, path: "other" }} />));
    expect(disclosure.open).toBe(false);
  });

  // Catches hiding controls by unmounting/disabling them or losing edits when closed.
  it("submits edited filters after the reader closes the controls", async () => {
    await act(async () => root.render(<SearchForm {...props} />));
    const summary = host.querySelector("summary")!;
    await act(async () => summary.click());
    const path = host.querySelector<HTMLInputElement>('input[name="path"]')!;
    path.value = "guides";
    await act(async () => path.dispatchEvent(new Event("input", { bubbles: true })));
    await act(async () => summary.click());
    expect(host.querySelector("details")!.open).toBe(false);
    await act(async () => host.querySelector("form")!.requestSubmit());
    expect(navigation.replace).toHaveBeenCalledWith(
      "/w/ws/search?q=needle&path=guides&from=2026-01-01&to=2026-02-01&sort=newest&offset=480&scope=workspace&source=src-1&archived=1",
      { scroll: false },
    );
    expect(path.value).toBe("guides");
  });
});

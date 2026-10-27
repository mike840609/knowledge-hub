// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SearchForm } from "@/components/search/search-form";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));

/**
 * Each search condition in force is a chip that removes that one condition: a link to the same search
 * without it, so it works without JavaScript and the result stays a shareable URL.
 */
type Props = Partial<Parameters<typeof SearchForm>[0]>;
function chips(props: Props) {
  const html = renderToStaticMarkup(
    <SearchForm workspaceId="ws" q="needle" scope="workspace" sourceId={null} includeArchived={false}
      sources={[{ id: "src-1", name: "Runbooks" } as never]} {...props} />,
  );
  const container = document.createElement("div");
  container.innerHTML = html;
  const region = container.querySelector('[aria-label="Active search filters"]');
  return [...(region?.querySelectorAll<HTMLAnchorElement>("a[aria-label^='Remove filter']") ?? [])].map((link) => ({
    name: link.getAttribute("aria-label"),
    text: link.textContent,
    params: Object.fromEntries(new URL(link.getAttribute("href")!, "http://x").searchParams),
  }));
}

describe("search filter chips", () => {
  it("shows none, and no filter row, when nothing narrows the search", () => {
    expect(chips({})).toEqual([]);
  });

  it("names each condition in force with its value", () => {
    const shown = chips({
      scope: "workspace", sourceId: "src-1", includeArchived: true,
      filters: { path: "docs/runbooks", from: "2026-01-01", to: "2026-02-01", sort: "newest" },
    });
    expect(shown.map((chip) => chip.text)).toEqual([
      "Path: docs/runbooks", "Updated from: 2026-01-01", "Updated to: 2026-02-01", "Sort: Newest first",
      "Source: Runbooks", "Archived: Included",
    ]);
    expect(shown[0]!.name).toBe("Remove filter Path: docs/runbooks");
  });

  it("removes only its own condition and keeps the rest of the search", () => {
    const [path, from] = chips({ includeArchived: true, filters: { path: "docs", from: "2026-01-01", offset: "-480" } });
    expect(path!.params).toEqual({ q: "needle", archived: "1", from: "2026-01-01", offset: "-480" });
    expect(from!.params).toEqual({ q: "needle", archived: "1", path: "docs", offset: "-480" });
  });

  it("treats relevance as no sort, and drops a chosen sort back to it", () => {
    expect(chips({ filters: { sort: "relevance" } })).toEqual([]);
    const [sort] = chips({ filters: { sort: "oldest" } });
    expect(sort!.text).toBe("Sort: Oldest first");
    expect(sort!.params).toEqual({ q: "needle" });
  });

  it("returns a widened scope to this workspace", () => {
    const [scope] = chips({ scope: "all" });
    expect(scope!.text).toBe("Scope: All my workspaces");
    expect(scope!.params).toEqual({ q: "needle" });
  });

  it("falls back to the id when a source is not in the list", () => {
    expect(chips({ sourceId: "gone" })[0]!.text).toBe("Source: gone");
  });

  it("leaves an empty query out of the link", () => {
    const [path] = chips({ q: "", filters: { path: "docs" } });
    expect(path!.params).toEqual({});
  });
});

import { describe, expect, it } from "vitest";
import { PAGE_ICONS, isPageIcon } from "@/lib/page-icon";

describe("page icons", () => {
  it("accepts the curated set and nothing else", () => {
    for (const icon of PAGE_ICONS) expect(isPageIcon(icon)).toBe(true);
    expect(isPageIcon("🙂")).toBe(false);
    expect(isPageIcon("not an emoji")).toBe(false);
    expect(isPageIcon(null)).toBe(false);
  });

  it("keeps the set small enough to scan", () => {
    expect(PAGE_ICONS.length).toBeLessThanOrEqual(24);
    expect(new Set(PAGE_ICONS).size).toBe(PAGE_ICONS.length);
  });
});

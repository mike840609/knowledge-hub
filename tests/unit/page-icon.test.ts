import { describe, expect, it } from "vitest";
import { EMOJI_CATALOG, EMOJI_GROUPS, searchEmoji } from "@/lib/emoji-catalog";
import { PAGE_ICONS, isPageIcon } from "@/lib/page-icon";

describe("page icons", () => {
  it("accepts the catalog and nothing else", () => {
    for (const icon of PAGE_ICONS) expect(isPageIcon(icon)).toBe(true);
    expect(isPageIcon("🪬")).toBe(false);
    expect(isPageIcon("not an emoji")).toBe(false);
    expect(isPageIcon(null)).toBe(false);
  });

  it("accepts every catalog emoji", () => {
    for (const { char } of EMOJI_CATALOG) expect(isPageIcon(char)).toBe(true);
  });

  it("keeps the suggested set small enough to scan", () => {
    expect(PAGE_ICONS.length).toBeLessThanOrEqual(24);
    expect(new Set(PAGE_ICONS).size).toBe(PAGE_ICONS.length);
  });

  it("opens the catalog with the suggested icons, once each", () => {
    expect(EMOJI_GROUPS[0].label).toBe("Suggested");
    expect(EMOJI_GROUPS[0].emoji.map((entry) => entry.char)).toEqual([...PAGE_ICONS]);
    expect(new Set(EMOJI_CATALOG.map((entry) => entry.char)).size).toBe(EMOJI_CATALOG.length);
    expect(EMOJI_CATALOG.length).toBeGreaterThanOrEqual(300);
  });

  it("searches name and keywords in English and Chinese, case-insensitively, in catalog order", () => {
    expect(searchEmoji("ROCKET").map((entry) => entry.char)).toContain("🚀");
    expect(searchEmoji("coffee")[0].char).toBe("☕");
    expect(searchEmoji("咖啡").map((entry) => entry.char)).toContain("☕");
    expect(searchEmoji("火箭").map((entry) => entry.char)).toEqual(["🚀"]);
    expect(searchEmoji("zzzz-nothing")).toEqual([]);
    const order = EMOJI_CATALOG.map((entry) => entry.char);
    const found = searchEmoji("heart").map((entry) => order.indexOf(entry.char));
    expect(found).toEqual([...found].sort((a, b) => a - b));
  });
});

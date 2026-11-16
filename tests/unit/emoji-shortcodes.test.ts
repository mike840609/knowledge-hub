import { describe, expect, it } from "vitest";
import { EMOJI_CATALOG, emojiForShortcode, emojiMatches, emojiShortcode } from "@/lib/emoji-catalog";

describe("the emoji shortcode index", () => {
  it("turns a name into the code a writer types", () => {
    expect(emojiShortcode(EMOJI_CATALOG[0])).toBe("page");
    expect(emojiShortcode({ char: "😀", name: "Grinning Face", keywords: [] })).toBe("grinning_face");
  });

  it("offers an exact shortcode or keyword before a prefix, and a prefix before a substring", () => {
    expect(emojiMatches("grinning_face")[0].name).toBe("grinning face");
    expect(emojiMatches("smile")[0].keywords).toContain("smile");
    expect(emojiMatches("heart")[0].name.toLowerCase().includes("heart") || emojiMatches("heart")[0].keywords.some((word) => word.startsWith("heart"))).toBe(true);
    expect(emojiMatches("zzzz")).toEqual([]);
    expect(emojiMatches("a", 3)).toHaveLength(3);
  });

  it("resolves a fully typed shortcode, by name or keyword", () => {
    expect(emojiForShortcode("grinning_face")?.char).toBe("😀");
    expect(emojiForShortcode("smile")?.keywords).toContain("smile");
    expect(emojiForShortcode("not_an_emoji")).toBeNull();
  });
});

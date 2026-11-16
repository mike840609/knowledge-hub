import { describe, expect, it } from "vitest";
import { EMOJI_CATALOG, emojiForShortcode, emojiMatches, emojiShortcode } from "@/lib/emoji-catalog";

describe("the emoji shortcode index", () => {
  it("turns a name into the code a writer types", () => {
    expect(emojiShortcode(EMOJI_CATALOG[0])).toBe("page");
    expect(emojiShortcode({ char: "😀", name: "Grinning Face", keywords: [] })).toBe("grinning_face");
  });

  it("offers an exact shortcode or keyword, or the name being typed, before other matches", () => {
    expect(emojiMatches("grinning_face")[0].name).toBe("grinning face");
    // A name prefix ties with an exact keyword; catalog order puts the name first.
    expect(emojiMatches("grin")[0].name).toBe("grinning face");
    expect(emojiMatches("joy")[0].name).not.toBe("joystick");
    expect(emojiMatches("joy")[0].keywords).toContain("joy");
    expect(emojiMatches("smile")[0].keywords).toContain("smile");
    expect(emojiMatches("heart")[0].name.toLowerCase().includes("heart") || emojiMatches("heart")[0].keywords.some((word) => word.startsWith("heart"))).toBe(true);
    expect(emojiMatches("zzzz")).toEqual([]);
    expect(emojiMatches("a", 3)).toHaveLength(3);
  });

  it("resolves a fully typed shortcode the same way the list does", () => {
    expect(emojiForShortcode("grinning_face")?.char).toBe("😀");
    expect(emojiForShortcode("smile")?.keywords).toContain("smile");
    expect(emojiForShortcode("grin")).toBe(emojiMatches("grin")[0]);
    expect(emojiForShortcode("joy")).toBe(emojiMatches("joy")[0]);
    expect(emojiForShortcode("not_an_emoji")).toBeNull();
  });

  it("takes the short codes people bring from other apps", () => {
    expect(emojiForShortcode("tada")?.name).toBe("party popper");
    expect(emojiForShortcode("thumbsup")?.name).toBe("thumbs up");
    expect(emojiForShortcode("100")?.name).toBe("hundred points");
  });

  it("accepts the longest code the catalog has", () => {
    expect(emojiForShortcode("grinning_face_with_smiling_eyes")).not.toBeNull();
  });
});

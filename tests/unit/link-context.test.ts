import { describe, expect, it } from "vitest";
import { LINK_CONTEXT_MAX_LENGTH, linkContext } from "@/modules/knowledge/domain/link-context";

describe("linkContext", () => {
  const body = ["# Title", "", "Plain sentence with [[Target]] inside.", "- item with [[Other|shown text]]", "> quoted [text](x.md) here"].join("\n");

  it("returns the line, reduced to what a reader reads", () => {
    expect(linkContext(body, 3)).toBe("Plain sentence with Target inside.");
    expect(linkContext(body, 4)).toBe("item with shown text");
    expect(linkContext(body, 5)).toBe("quoted text here");
  });

  it("strips heading, list, task and quote markers", () => {
    expect(linkContext("## Heading [[A]]", 1)).toBe("Heading A");
    expect(linkContext("1. numbered [[A]]", 1)).toBe("numbered A");
    expect(linkContext("- [x] done [[A]]", 1)).toBe("done A");
    expect(linkContext("> > nested [[A]]", 1)).toBe("nested A");
  });

  it("keeps a wikilink's heading as part of what is shown", () => {
    expect(linkContext("see [[Note#Setup]]", 1)).toBe("see Note › Setup");
    expect(linkContext("see [[Note#Setup|the setup]]", 1)).toBe("see the setup");
  });

  it("drops image syntax down to its alt text", () => {
    expect(linkContext("![diagram](a.png) and [[A]]", 1)).toBe("diagram and A");
  });

  it("collapses whitespace", () => {
    expect(linkContext("a   [[B]]\t\tc", 1)).toBe("a B c");
  });

  it("is null for a line that does not exist or is empty once reduced", () => {
    expect(linkContext(body, 0)).toBeNull();
    expect(linkContext(body, 99)).toBeNull();
    expect(linkContext(body, 2)).toBeNull();
    expect(linkContext("-   ", 1)).toBeNull();
    expect(linkContext(body, 1.5)).toBeNull();
  });

  it("reads Windows line endings", () => {
    expect(linkContext("first\r\nsecond [[A]]", 2)).toBe("second A");
  });

  it("cuts a long line on a code point", () => {
    const long = `${"😀".repeat(LINK_CONTEXT_MAX_LENGTH + 40)} [[A]]`;
    const context = linkContext(long, 1)!;
    expect(Array.from(context)).toHaveLength(LINK_CONTEXT_MAX_LENGTH);
    expect(context.endsWith("…")).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { escapeSummaryText, flipOpenTag } from "@/components/knowledge/editor/details-toggle";
describe("flipOpenTag", () => {
  it("adds and removes the open attribute", () => {
    expect(flipOpenTag("<details>")).toBe("<details open>");
    expect(flipOpenTag("<details open>")).toBe("<details>");
  });
  it("ignores surrounding whitespace and rejects anything else", () => {
    expect(flipOpenTag("  <details>  ")).toBe("<details open>");
    expect(flipOpenTag("</details>")).toBeNull();
    expect(flipOpenTag('<details class="x">')).toBeNull();
    expect(flipOpenTag("<summary>x</summary>")).toBeNull();
  });
});
describe("escapeSummaryText", () => {
  it("escapes what would break the summary line", () => {
    expect(escapeSummaryText("a<b>&c>d")).toBe("a&lt;b&gt;&amp;c&gt;d");
    expect(escapeSummaryText("plain")).toBe("plain");
  });
});

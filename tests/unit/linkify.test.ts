import { describe, expect, it } from "vitest";
import { linkify } from "@/lib/linkify";

describe("linkify", () => {
  it("leaves text without links as one run", () => {
    expect(linkify("No links here.")).toEqual([{ text: "No links here." }]);
    expect(linkify("")).toEqual([]);
  });

  it("links http and https URLs in place, keeping the surrounding text", () => {
    expect(linkify("See https://example.com/pr/1 and http://a.test")).toEqual([
      { text: "See " },
      { text: "https://example.com/pr/1", href: "https://example.com/pr/1" },
      { text: " and " },
      { text: "http://a.test", href: "http://a.test/" },
    ]);
  });

  it("keeps sentence punctuation and an enclosing bracket out of the link", () => {
    expect(linkify("Done: https://example.com/x.")).toEqual([{ text: "Done: " }, { text: "https://example.com/x", href: "https://example.com/x" }, { text: "." }]);
    expect(linkify("(see https://example.com/y)")).toEqual([{ text: "(see " }, { text: "https://example.com/y", href: "https://example.com/y" }, { text: ")" }]);
    expect(linkify("https://en.wikipedia.org/wiki/A_(b)")[0]).toEqual({ text: "https://en.wikipedia.org/wiki/A_(b)", href: "https://en.wikipedia.org/wiki/A_(b)" });
  });

  it("never links other schemes or markup", () => {
    for (const text of ["javascript:alert(1)", "data:text/html,<b>x</b>", "<a href=\"https://x.test\">x</a> ", "ftp://x.test", "mailto:a@b.test"]) {
      expect(linkify(text).filter(part => part.href && !part.href.startsWith("https://x.test"))).toEqual([]);
    }
    // A quote or angle bracket ends a URL, so an attribute cannot ride along.
    expect(linkify("https://x.test/\"onmouseover=\"alert(1)")[0]).toEqual({ text: "https://x.test/", href: "https://x.test/" });
  });

  it("joins back to the original text", () => {
    const text = "a https://x.test/1, b (https://y.test/2) c https://z.test/3?q=1#f!";
    expect(linkify(text).map(part => part.text).join("")).toBe(text);
  });
});

import { describe, expect, it } from "vitest";
import { plainSearchSnippet } from "@/lib/search-snippet";

describe("plainSearchSnippet", () => {
  it("removes a repeated document heading and unfinished image syntax", () => {
    expect(plainSearchSnippet(
      "# 💰 Assets Tracker 使用說明\n歡迎使用 **Assets Tracker**！\n![Assets Tracker Dashboar",
    )).toBe("歡迎使用 Assets Tracker！");
  });

  it("keeps meaningful text from links, wiki links and list excerpts", () => {
    expect(plainSearchSnippet(
      "- See [setup guide](https://example.com/setup) and [[Notes/Source|source notes]].",
    )).toBe("See setup guide and source notes.");
  });

  it("removes a leading heading even when it differs from the saved title", () => {
    expect(plainSearchSnippet("# Release notes\nNew content"))
      .toBe("New content");
  });

  it("keeps link labels when a database excerpt cuts off the URL", () => {
    expect(plainSearchSnippet("See [Assets Tracker on GitHub](https://github.com/example/a"))
      .toBe("See Assets Tracker on GitHub");
  });

  it("leaves an uncut excerpt unmarked", () => {
    expect(plainSearchSnippet("Whole body.", { start: false, end: false })).toBe("Whole body.");
  });

  it("drops a word cut in half at the start and marks the cut", () => {
    expect(plainSearchSnippet("ems where /bin/sh runs", { start: true, end: false }))
      .toBe("…where /bin/sh runs");
  });

  it("drops half a Markdown link at the start rather than showing its syntax", () => {
    expect(plainSearchSnippet("guide](https://example.com) and more", { start: true, end: false }))
      .toBe("…and more");
  });

  it("keeps CJK text at a cut edge, where every character is a boundary", () => {
    expect(plainSearchSnippet("指令指南與說明", { start: true, end: true })).toBe("…指令指南與說明…");
  });

  it("drops a word cut in half at the end and marks the cut", () => {
    expect(plainSearchSnippet("the first match, then rror", { start: false, end: true }))
      .toBe("the first match, then…");
  });

  it("reads a wiki link whose closing brackets were cut to one as its target", () => {
    expect(plainSearchSnippet("見 [[Tool/git-common-commands]", { start: false, end: false }))
      .toBe("見 Tool/git-common-commands");
    expect(plainSearchSnippet("見 [[Tool/git|git 常用指令]", { start: false, end: false }))
      .toBe("見 git 常用指令");
  });

  it("returns nothing, not a lone ellipsis, when the cut leaves no text", () => {
    expect(plainSearchSnippet("https://example.com/very/long", { start: true, end: true })).toBe("");
  });
});

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
});

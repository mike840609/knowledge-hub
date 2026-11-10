import { describe, expect, it } from "vitest";
import { userGuideContent } from "@/components/help/user-guide-content";

const ids = (locale: "en" | "zh-TW", taskSearch: boolean) =>
  userGuideContent(locale, { taskSearch }).sections.map((section) => section.id);
const text = (locale: "en" | "zh-TW", taskSearch: boolean) =>
  JSON.stringify(userGuideContent(locale, { taskSearch }));
const ORDER = ["quick-start", "sync", "troubleshooting", "reading", "inbox", "insights", "tasks", "sharing-export"];

describe("user guide content", () => {
  it("places Inbox after reading and Tasks after Insights", () => {
    expect(ids("en", false)).toEqual(ORDER);
    expect(ids("zh-TW", true)).toEqual(ORDER);
  });

  it("only describes Task Search when the deployment enables it", () => {
    expect(text("en", false)).not.toContain("Search title, summary and findings");
    expect(text("en", true)).toContain("Search title, summary and findings");
    expect(text("zh-TW", false)).not.toContain("搜尋標題、摘要與 findings");
    expect(text("zh-TW", true)).toContain("搜尋標題、摘要與 findings");
  });

  it("links the new chapters into My Space", () => {
    for (const locale of ["en", "zh-TW"] as const) {
      expect(text(locale, false)).toContain('"target":"inbox"');
      expect(text(locale, false)).toContain('"target":"tasks"');
      expect(text(locale, false)).toContain('"target":"taskSetup"');
    }
  });
});

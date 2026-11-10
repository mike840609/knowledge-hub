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
    expect(text("en", false)).not.toContain("With search enabled");
    expect(text("en", true)).toContain("With search enabled");
    expect(text("en", false)).not.toContain("Search and filters");
    expect(text("en", true)).toContain("Search and filters");
    expect(text("zh-TW", false)).not.toContain("啟用搜尋時");
    expect(text("zh-TW", true)).toContain("啟用搜尋時");
    expect(text("zh-TW", false)).not.toContain("搜尋與篩選");
    expect(text("zh-TW", true)).toContain("搜尋與篩選");
  });

  it("states the badge, row and archive rules the product actually uses", () => {
    for (const locale of ["en", "zh-TW"] as const) {
      const body = text(locale, false);
      expect(body).toContain(locale === "en" ? "counts unread items" : "未讀項目");
      expect(body).toContain(locale === "en" ? "Status (Any status / Open / Resolved)" : "Status（Any status／Open／Resolved）");
      expect(body).toContain(locale === "en" ? "revision when a task has more than one" : "超過一個版本時才顯示 revision");
      expect(body).toContain(locale === "en" ? "Archived results stay readable and can be restored" : "封存後仍可閱讀，也能從同一頁還原");
      expect(body).toContain("64 KiB");
    }
  });

  it("links the new chapters into My Space", () => {
    for (const locale of ["en", "zh-TW"] as const) {
      expect(text(locale, false)).toContain('"target":"inbox"');
      expect(text(locale, false)).toContain('"target":"tasks"');
      expect(text(locale, false)).toContain('"target":"taskSetup"');
    }
  });
});

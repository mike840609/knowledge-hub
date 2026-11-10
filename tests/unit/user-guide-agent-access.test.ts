import { describe, expect, it } from "vitest";
import { userGuideContent } from "@/components/help/user-guide-content";

describe("user guide: agent export and read", () => {
  for (const locale of ["en", "zh-TW"] as const) {
    it(`${locale} names the three commands, the setup page and how to stop reading`, () => {
      const sharing = userGuideContent(locale).sections.find(section => section.id === "sharing-export");
      const text = JSON.stringify(sharing?.details);
      for (const command of ["/hub-export", "/hub-search", "/hub-read"]) expect(text).toContain(command);
      expect(text).toContain("Set up export");
      expect(text).toContain(locale === "en" ? "revoke" : "撤銷");
    });
  }
});

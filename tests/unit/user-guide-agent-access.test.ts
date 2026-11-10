import { describe, expect, it } from "vitest";
import { userGuideContent } from "@/components/help/user-guide-content";

describe("user guide: agent read access", () => {
  for (const locale of ["en", "zh-TW"] as const) {
    it(`${locale} Tasks section names the read commands, their limits and how to stop them`, () => {
      const tasks = userGuideContent(locale).sections.find(section => section.id === "tasks");
      const text = JSON.stringify(tasks?.details);
      for (const command of ["/hub-search", "/hub-read"]) expect(text).toContain(command);
      expect(text).toContain("Team");
      expect(text).toContain("Revoke");
      expect(text).toContain(locale === "en" ? "only reads" : "只能讀");
    });
  }
});

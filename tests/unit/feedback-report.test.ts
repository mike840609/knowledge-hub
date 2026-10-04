import {expect,it} from "vitest";
import {feedbackReport} from "@/lib/feedback-report";
it("exports the user's description and route, without inventing an automatic submission",()=>{
  const report=feedbackReport("Sync","  Preview failed  ","/w/personal/sources");
  expect(report).toContain("Category: Sync");expect(report).toContain("Page: /w/personal/sources");expect(report).toContain("\nPreview failed\n");expect(report).not.toContain("http");
});

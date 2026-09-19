import { describe, expect, it } from "vitest";
import { markdownStartsWithDocumentTitle } from "@/lib/markdown-title";

describe("markdownStartsWithDocumentTitle", () => {
  it("recognizes an opening heading with a decorative emoji", () => {
    expect(markdownStartsWithDocumentTitle("# 💰 Assets Tracker 使用說明\n\nWelcome", "Assets Tracker 使用說明")).toBe(true);
  });

  it("keeps a different heading and does not match headings later in the document", () => {
    expect(markdownStartsWithDocumentTitle("# Getting started\n\nText", "Assets Tracker 使用說明")).toBe(false);
    expect(markdownStartsWithDocumentTitle("Intro\n\n# Assets Tracker 使用說明", "Assets Tracker 使用說明")).toBe(false);
  });
});

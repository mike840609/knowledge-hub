import { expect, it } from "vitest";
import { MAX_MARKDOWN_BYTES, markdownBytes, markdownTooLarge } from "@/lib/markdown-limits";

it("counts UTF-8 bytes, not JavaScript code units", () => {
  expect(markdownBytes("中")).toBe(3);
  expect(markdownTooLarge("中".repeat(2_000_000))).toBe(true);
  expect(markdownTooLarge("x".repeat(MAX_MARKDOWN_BYTES))).toBe(false);
  expect(markdownTooLarge("x".repeat(MAX_MARKDOWN_BYTES + 1))).toBe(true);
});

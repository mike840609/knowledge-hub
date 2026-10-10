import { expect, it } from "vitest";
import { isStoredImage, needsImageBytes } from "@/modules/sources/domain/stored-image";

const hash = "a".repeat(64);
it("an image is stored only with a hash, the stored flag and an image extension", () => {
  expect(isStoredImage({ sourcePath: "a.png", contentHash: hash, metadata: { stored: true } })).toBe(true);
  expect(isStoredImage({ sourcePath: "a.png", contentHash: hash, metadata: {} })).toBe(false);
  expect(isStoredImage({ sourcePath: "a.png", contentHash: hash, metadata: { stored: "true" } })).toBe(false);
  expect(isStoredImage({ sourcePath: "a.png", contentHash: null, metadata: { stored: true } })).toBe(false);
  expect(isStoredImage({ sourcePath: "a.pdf", contentHash: hash, metadata: { stored: true } })).toBe(false);
});
it("bytes are needed for a non-empty image this source does not already store", () => {
  const none = new Set<string>();
  expect(needsImageBytes({ relativePath: "a.png", size: 10, contentHash: hash }, none)).toBe(true);
  expect(needsImageBytes({ relativePath: "a.png", size: 10, contentHash: hash }, new Set([hash]))).toBe(false);
  expect(needsImageBytes({ relativePath: "a.png", size: 0, contentHash: hash }, none)).toBe(false);
  expect(needsImageBytes({ relativePath: "a.pdf", size: 10, contentHash: hash }, none)).toBe(false);
});

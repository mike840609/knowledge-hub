import { describe, expect, it } from "vitest";
import {
  COLLECTION_PAGE_SIZE,
  MAX_COLLECTION_ITEMS,
  encodeCollectionCursor,
  normalizeCollectionDescription,
  normalizeCollectionName,
  normalizeReadingNote,
  parseCollectionCursor,
  parseCollectionVersion,
  validateCollectionOrder,
} from "@/modules/knowledge/domain/knowledge-collection";

const FIRST = "0199b29e-ef74-74ec-8abe-dcdf8651b811";
const SECOND = "0199b29e-ef74-74ec-8abe-dcdf8651b812";

describe("knowledge collection domain", () => {
  it("normalizes collection text within bounds", () => {
    expect(normalizeCollectionName("  Onboarding Guide  ")).toBe("Onboarding Guide");
    expect(normalizeCollectionDescription("  Read these first  ")).toBe("Read these first");
    expect(normalizeCollectionDescription(undefined)).toBe("");
    expect(normalizeReadingNote("  Why this matters  ")).toBe("Why this matters");
    expect(MAX_COLLECTION_ITEMS).toBe(200);
    expect(COLLECTION_PAGE_SIZE).toBe(50);
  });

  it("rejects empty names, invalid types and out-of-range unicode text", () => {
    expect(() => normalizeCollectionName("  ")).toThrow();
    expect(() => normalizeCollectionName("a".repeat(121))).toThrow();
    expect(() => normalizeCollectionName(12)).toThrow();
    expect(() => normalizeCollectionDescription("a".repeat(2001))).toThrow();
    expect(() => normalizeReadingNote("🙂".repeat(501))).toThrow();
    expect(normalizeReadingNote("🙂".repeat(500))).toHaveLength(1000);
    expect(() => normalizeReadingNote({text:"unsafe"})).toThrow();
  });

  it("requires a duplicate-free exact item permutation", () => {
    expect(() => validateCollectionOrder([FIRST, SECOND], [SECOND, FIRST])).not.toThrow();
    expect(() => validateCollectionOrder([FIRST, SECOND], [FIRST])).toThrow();
    expect(() => validateCollectionOrder([FIRST, SECOND], [FIRST, FIRST])).toThrow();
    expect(() => validateCollectionOrder([FIRST], [SECOND])).toThrow();
  });

  it("accepts only positive safe integer versions", () => {
    expect(parseCollectionVersion(1)).toBe(1);
    for (const invalid of [0, -1, 1.5, "1", null, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => parseCollectionVersion(invalid)).toThrow();
    }
  });

  it("round-trips a stable, bounded cursor and rejects malformed input", () => {
    const at = new Date("2026-10-15T09:01:02.123Z");
    const cursor = encodeCollectionCursor(at, FIRST);
    expect(parseCollectionCursor(cursor)).toEqual({ updatedAt: at, id: FIRST });
    expect(parseCollectionCursor(null)).toBeNull();
    expect(() => parseCollectionCursor("!")).toThrow();
    expect(() => parseCollectionCursor("a".repeat(5000))).toThrow();
    expect(() => parseCollectionCursor("not a uuid")).toThrow();
  });

  it("treats HTML-looking item notes as inert plain text", () => {
    const text = '<img src=x onerror=alert(1)><script>evil()</script>';
    expect(normalizeReadingNote(text)).toBe(text);
  });
});

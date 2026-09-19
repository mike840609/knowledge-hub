import { describe, expect, it } from "vitest";
import { parseDocumentShortcuts, rememberDocument, toggleFavoriteDocument } from "@/lib/document-shortcuts";

describe("document shortcuts", () => {
  it("keeps recent documents unique and newest first", () => {
    const first = rememberDocument({ recent: ["source:a", "source:b"], favorites: [] }, "source:b");
    expect(first.recent).toEqual(["source:b", "source:a"]);
  });

  it("pins and unpins a document without changing recent history", () => {
    const initial = { recent: ["source:a"], favorites: [] };
    const pinned = toggleFavoriteDocument(initial, "source:a");
    expect(pinned).toEqual({ recent: ["source:a"], favorites: ["source:a"] });
    expect(toggleFavoriteDocument(pinned, "source:a")).toEqual(initial);
  });

  it("ignores invalid stored data", () => {
    expect(parseDocumentShortcuts("not json")).toEqual({ recent: [], favorites: [] });
    expect(parseDocumentShortcuts('{"recent":["source:a",17,"source:a"],"favorites":[]}'))
      .toEqual({ recent: ["source:a"], favorites: [] });
  });
});

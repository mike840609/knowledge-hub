import { describe, expect, it } from "vitest";
import { FAVORITES_SHOWN, documentIdInPath, favoritesInPlace, parseDocumentShortcuts, recentDocumentIds, rememberDocument, toggleFavoriteDocument } from "@/lib/document-shortcuts";

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

describe("recentDocumentIds", () => {
  it("is the documents opened lately, as IDs, newest first", () => {
    expect(recentDocumentIds({ recent: ["s1:d3", "s1:d2", "s2:d1"], favorites: [] })).toEqual(["d3", "d2", "d1"]);
  });

  it("leaves out the document being read: the palette is for going somewhere else", () => {
    expect(recentDocumentIds({ recent: ["s1:d3", "s1:d2", "s2:d1"], favorites: [] }, "d3")).toEqual(["d2", "d1"]);
  });

  it("is not thrown by a remembered key that is not `source:document`, and names a document once", () => {
    expect(recentDocumentIds({ recent: ["nonsense", "s1:d1", "s2:d1", "s1:"], favorites: [] })).toEqual(["d1"]);
  });

  it("is what was remembered, favorites or not", () => {
    expect(recentDocumentIds({ recent: ["s1:d1"], favorites: ["s1:d1", "s1:d9"] })).toEqual(["d1"]);
  });
});

describe("favoritesInPlace", () => {
  const keys = (count: number) => Array.from({ length: count }, (_, index) => `source:${index + 1}`);

  it("lists four in place", () => {
    expect(FAVORITES_SHOWN).toBe(4);
  });

  it("has no Show all row for none, or up to four, and lists them all in place in the order given", () => {
    expect(favoritesInPlace([])).toEqual({ inPlace: [], showAll: null });
    expect(favoritesInPlace(keys(3))).toEqual({ inPlace: keys(3), showAll: null });
    expect(favoritesInPlace(keys(4))).toEqual({ inPlace: keys(4), showAll: null });
  });

  it("lists the first four in place from five on, and says how many there are in all, not how many are behind the row", () => {
    expect(favoritesInPlace(keys(5))).toEqual({ inPlace: keys(4), showAll: 5 });
    expect(favoritesInPlace(keys(10))).toEqual({ inPlace: keys(4), showAll: 10 });
  });

  it("does not change what it was given", () => {
    const given = keys(6);
    favoritesInPlace(given);
    expect(given).toEqual(keys(6));
  });
});

describe("documentIdInPath", () => {
  const workspace = "01a0f5b0-0000-7000-8000-000000000001";
  const source = "01a0f5b0-0000-7000-8000-000000000002";
  const document = "01a0f5b0-0000-7000-8000-000000000003";

  it("reads the document of a document page, and of the pages under it", () => {
    expect(documentIdInPath(`/w/${workspace}/knowledge/${source}/${document}`)).toBe(document);
    expect(documentIdInPath(`/w/${workspace}/knowledge/${source}/${document}/edit`)).toBe(document);
    expect(documentIdInPath(`/w/${workspace}/knowledge/${source}/${document}/`)).toBe(document);
  });

  it("is undefined for a path that is not on a document", () => {
    expect(documentIdInPath(`/w/${workspace}/knowledge/${source}`)).toBeUndefined();
    expect(documentIdInPath(`/w/${workspace}/knowledge/new`)).toBeUndefined();
    expect(documentIdInPath(`/w/${workspace}/knowledge`)).toBeUndefined();
    expect(documentIdInPath(`/w/${workspace}/graph`)).toBeUndefined();
    expect(documentIdInPath(`/w/${workspace}/home`)).toBeUndefined();
    expect(documentIdInPath("/")).toBeUndefined();
  });

  it("does not take a segment that is not an ID for one", () => {
    expect(documentIdInPath(`/w/${workspace}/knowledge/${source}/new`)).toBeUndefined();
    expect(documentIdInPath(`/w/${workspace}/knowledge/${source}/not-a-uuid/edit`)).toBeUndefined();
  });

  it("takes the whole segment or nothing, and the ID as it is stored", () => {
    expect(documentIdInPath(`/w/${workspace}/knowledge/${source}/${document}0`)).toBeUndefined();
    expect(documentIdInPath(`/w/${workspace}/knowledge/${source}/${document}-x/edit`)).toBeUndefined();
    expect(documentIdInPath(`/w/${workspace}/knowledge/${source}/${document.toUpperCase()}`)).toBe(document);
  });

  it("is not fooled by an ID in another place in the path", () => {
    expect(documentIdInPath(`/w/${workspace}/search/${source}/${document}`)).toBeUndefined();
    expect(documentIdInPath(`/x/w/${workspace}/knowledge/${source}/${document}`)).toBeUndefined();
  });
});

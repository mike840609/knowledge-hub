import { describe, expect, it } from "vitest";
import {
  highlightSnippet,
  parseSearchQuery,
  toLikePattern,
  SEARCH_MAX_QUERY_LENGTH,
  SEARCH_MAX_TERMS,
  SEARCH_MAX_TERM_LENGTH,
} from "@/modules/knowledge/domain/search-query";

describe("parseSearchQuery", () => {
  it("splits on whitespace including the full-width space U+3000", () => {
    expect(parseSearchQuery("請假　流程 leave").terms).toEqual(["請假", "流程", "leave"]);
  });

  it("drops duplicate terms case-insensitively and keeps the first spelling", () => {
    expect(parseSearchQuery("SWFP swfp SWFP").terms).toEqual(["SWFP"]);
  });

  it("keeps at most SEARCH_MAX_TERMS terms", () => {
    const parsed = parseSearchQuery("a1 b2 c3 d4 e5 f6 g7");
    expect(parsed.terms).toHaveLength(SEARCH_MAX_TERMS);
    expect(parsed.terms).toEqual(["a1", "b2", "c3", "d4", "e5"]);
  });

  it("truncates a single term to SEARCH_MAX_TERM_LENGTH characters", () => {
    const long = "x".repeat(SEARCH_MAX_TERM_LENGTH + 10);
    expect(parseSearchQuery(long).terms[0]).toHaveLength(SEARCH_MAX_TERM_LENGTH);
  });

  it("reports an over-long query instead of parsing it", () => {
    const parsed = parseSearchQuery("y".repeat(SEARCH_MAX_QUERY_LENGTH + 1));
    expect(parsed).toEqual({ terms: [], tooLong: true });
  });

  it("returns no terms for empty or whitespace-only input", () => {
    expect(parseSearchQuery("")).toEqual({ terms: [], tooLong: false });
    expect(parseSearchQuery("   　  ")).toEqual({ terms: [], tooLong: false });
  });
});

describe("toLikePattern", () => {
  it("wraps the term in wildcards", () => {
    expect(toLikePattern("請假")).toBe("%請假%");
  });

  it("escapes the ESCAPE character itself, percent and underscore", () => {
    expect(toLikePattern("100%")).toBe("%100!%%");
    expect(toLikePattern("a_b")).toBe("%a!_b%");
    expect(toLikePattern("wow!")).toBe("%wow!!%");
    expect(toLikePattern("!%_")).toBe("%!!!%!_%");
  });
});

describe("highlightSnippet", () => {
  it("marks matches case-insensitively and keeps the original casing", () => {
    expect(highlightSnippet("SWFP leave policy", ["swfp"])).toEqual([
      { text: "SWFP", match: true },
      { text: " leave policy", match: false },
    ]);
  });

  it("marks every occurrence of every term", () => {
    expect(highlightSnippet("請假流程與請假表單", ["請假"])).toEqual([
      { text: "請假", match: true },
      { text: "流程與", match: false },
      { text: "請假", match: true },
      { text: "表單", match: false },
    ]);
  });

  it("returns the whole snippet unmarked when nothing matches", () => {
    expect(highlightSnippet("nothing here", ["absent"])).toEqual([{ text: "nothing here", match: false }]);
    expect(highlightSnippet("nothing here", [])).toEqual([{ text: "nothing here", match: false }]);
  });
});

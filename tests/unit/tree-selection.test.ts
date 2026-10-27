import { describe, expect, it } from "vitest";
import { selectionRange } from "@/lib/tree-selection";

describe("tree selection", () => {
  const ids = ["a", "b", "c", "d"];

  it("covers both ends and everything the tree shows between them", () => {
    expect(selectionRange(ids, "b", "d")).toEqual(["b", "c", "d"]);
    expect(selectionRange(ids, "d", "b")).toEqual(["b", "c", "d"]);
  });

  it("selects just the row when it is the anchor", () => {
    expect(selectionRange(ids, "c", "c")).toEqual(["c"]);
  });

  it("falls back to the row when the anchor is no longer in the tree", () => {
    expect(selectionRange(ids, "gone", "c")).toEqual(["c"]);
  });
});

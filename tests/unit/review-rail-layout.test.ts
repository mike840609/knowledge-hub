import { expect, test } from "vitest";
import { compareReviewPassages, positionReviewThreads } from "@/components/knowledge/review-rail-layout";
import type { ReviewThreadView } from "@/modules/knowledge/domain/document-review";

test("cards follow passages with space for long replies and unmapped discussions", () => {
  expect(positionReviewThreads([
    { id: "early", top: 100, height: 200 },
    { id: "overlap", top: 140, height: 150 },
    { id: "later", top: 900, height: 100 },
    { id: "outdated", top: null, height: 80 },
  ])).toEqual({ positions: { early: 100, overlap: 312, later: 900, outdated: 1012 }, height: 1092 });
});

test("selected card stays beside its passage by moving preceding cards up without overlap", () => {
  expect(positionReviewThreads([
    { id: "first", top: 600, height: 100 },
    { id: "selected", top: 600, height: 300 },
    { id: "next", top: 620, height: 100 },
  ], "selected")).toEqual({ positions: { first: 488, selected: 600, next: 912 }, height: 1012 });
});

test("dense cards near the top stay below the toolbar and in document order", () => {
  expect(positionReviewThreads([
    { id: "first", top: -80, height: 180 },
    { id: "selected", top: 20, height: 200 },
  ], "selected")).toEqual({ positions: { first: 0, selected: 192 }, height: 392 });
  expect(positionReviewThreads([])).toEqual({ positions: {}, height: 0 });
});

test("document order is numeric, with outdated anchors at the end", () => {
  const thread = (id: string, path?: number[], startUtf16 = 0) => ({
    id, currentAnchor: path ? { match: "MATCHED", anchor: { blockPath: path, startUtf16 } } : { match: "OUTDATED" },
  } as ReviewThreadView);
  expect([thread("outdated"), thread("ten", [10]), thread("two-later", [2], 9), thread("two", [2]), thread("nested", [2, 0])]
    .sort(compareReviewPassages).map(item => item.id)).toEqual(["two", "two-later", "nested", "ten", "outdated"]);
});

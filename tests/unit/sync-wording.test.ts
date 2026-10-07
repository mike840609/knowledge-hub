import { expect, it } from "vitest";
import { changeLabelText } from "@/lib/sync-wording";

it.each([
  [["ADDED"], "Added"],
  [["UPDATED", "RENAMED", "MOVED"], "Moved + Renamed + Updated"],
  [["RESTORED"], "Restored"],
  [[], "Changed"],
])("words %j as %s", (labels, words) => {
  expect(changeLabelText(labels)).toBe(words);
});

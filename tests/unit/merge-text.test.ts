import { expect, it } from "vitest";
import { mergeText } from "@/lib/merge-text";

const base = ["# Plan", "", "one", "", "two", "", "three"].join("\n");

it("keeps both sides' changes to different paragraphs", () => {
  const mine = base.replace("one", "one, edited here");
  const theirs = base.replace("three", "three, edited elsewhere");
  expect(mergeText(base, mine, theirs)).toBe(base.replace("one", "one, edited here").replace("three", "three, edited elsewhere"));
});

it("keeps insertions at different places and appended text", () => {
  const mine = `${base}\n\nfour`;
  const theirs = base.replace("# Plan", "# Plan\n\nintro");
  expect(mergeText(base, mine, theirs)).toBe(`${base.replace("# Plan", "# Plan\n\nintro")}\n\nfour`);
});

it("refuses changes to the same or neighbouring lines", () => {
  expect(mergeText(base, base.replace("two", "mine"), base.replace("two", "theirs"))).toBeNull();
  expect(mergeText("a\nb\nc", "a\nB\nc", "a\nb\nC")).toBeNull();
  expect(mergeText(base, `${base}\nmine`, `${base}\ntheirs`)).toBeNull();
});

it("takes the one side that changed, and an identical change once", () => {
  const changed = base.replace("two", "2");
  expect(mergeText(base, base, changed)).toBe(changed);
  expect(mergeText(base, changed, base)).toBe(changed);
  expect(mergeText(base, changed, changed)).toBe(changed);
  const both = `${changed}\n\nfour`;
  expect(mergeText(base, both, base.replace("# Plan", "# Plan!").replace("two", "2"))).toBe(`# Plan!${both.slice("# Plan".length)}`);
});

it("handles deletions and an empty base", () => {
  expect(mergeText(base, base.replace("\n\none", ""), base.replace("three", "3"))).toBe(base.replace("\n\none", "").replace("three", "3"));
  expect(mergeText("", "mine", "theirs")).toBeNull();
  expect(mergeText("", "", "theirs")).toBe("theirs");
});

it("does not count a final newline as an edit", () => {
  expect(mergeText("a\n\nb\n\nc", "a!\n\nb\n\nc\n", "a\n\nb\n\nc!")).toBe("a!\n\nb\n\nc!\n");
});

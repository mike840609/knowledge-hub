import { expect, it } from "vitest";
import { countWords } from "@/shared/markdown/word-count";

it.each([
  ["", 0],
  ["Hello world", 2],
  ["# Title\n\n- one\n- two\n\n1. three\n2. four", 5],
  ["**bold** and `code` and _it_", 5],
  ["see [the guide](https://example.com/a/b) and ![alt text](x.png)", 4],
  ["go to [[Roadmap|the plan]] now", 4],
  ["```ts\nlet a = 1\n```", 3],
  ["<details>\n<summary>Fold</summary>\n\nInside\n\n</details>", 2],
  ["請假流程說明", 6],
  ["請假 flow 說明 and 2026", 7],
  ["don't stop-gap", 2],
  ["नमस्ते दुनिया", 2],
  ["मेरा नाम राहुल है", 4],
  ["שָׁלוֹם עוֹלָם", 2],
  ["cafe\u0301 are nice", 3],
  ["[ref]: https://example.com/x \"Title\"\n\ntext", 1],
  ["Visit https://example.com/a/b-c_d?x=1 now", 2],
  ["![[img.png]] and text", 2],
  ["1,000.50 and 3.14 and 2026-11-20", 5],
  ["- a\n  - 1. nested\n> 1. quoted", 3],
])("counts %j as %i", (markdown, expected) => {
  expect(countWords(markdown)).toBe(expected);
});

it("stays fast on a long line with no closer", () => {
  const started = performance.now();
  countWords("a < b ".repeat(10_000));
  countWords("![a ".repeat(10_000));
  countWords("[[a ".repeat(10_000));
  expect(performance.now() - started).toBeLessThan(500);
});

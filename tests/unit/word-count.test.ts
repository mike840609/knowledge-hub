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
])("counts %j as %i", (markdown, expected) => {
  expect(countWords(markdown)).toBe(expected);
});

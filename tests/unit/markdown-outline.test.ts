import { describe, expect, it } from "vitest";
import { extractOutline } from "@/shared/markdown/outline";

const doc = (...lines: string[]) => lines.join("\n");

describe("extractOutline", () => {
  it("lists headings in reading order with relative levels", () => {
    const outline = extractOutline(doc("# Title", "", "## Setup", "", "### Install", "", "## Usage"));
    expect(outline.map(({ slug, text, depth, level }) => [slug, text, depth, level])).toEqual([
      ["title", "Title", 1, 0],
      ["setup", "Setup", 2, 1],
      ["install", "Install", 3, 2],
      ["usage", "Usage", 2, 1],
    ]);
  });

  it("indents relative to the shallowest heading, not to h1", () => {
    const outline = extractOutline(doc("## A", "", "### B", "", "## C"));
    expect(outline.map((entry) => entry.level)).toEqual([0, 1, 0]);
  });

  it("does not list a document with fewer than two headings", () => {
    expect(extractOutline("# Only one")).toEqual([]);
    expect(extractOutline("no headings at all")).toEqual([]);
    expect(extractOutline("")).toEqual([]);
  });

  it("does not list headings deeper than four levels", () => {
    const outline = extractOutline(doc("# A", "", "## B", "", "##### deep", "", "###### deeper"));
    expect(outline.map((entry) => entry.text)).toEqual(["A", "B"]);
  });

  it("numbers duplicates and still counts headings that are not listed", () => {
    const outline = extractOutline(doc("## Notes", "", "##### Notes", "", "## Notes"));
    expect(outline.map((entry) => entry.slug)).toEqual(["notes", "notes-2"]);
  });

  it("ignores a # inside a code fence", () => {
    const outline = extractOutline(doc("## Real", "", "```sh", "# not a heading", "```", "", "## Also real"));
    expect(outline.map((entry) => entry.text)).toEqual(["Real", "Also real"]);
  });

  it("reads setext headings", () => {
    const outline = extractOutline(doc("Title", "=====", "", "Sub", "---", "", "text"));
    expect(outline.map((entry) => [entry.text, entry.depth])).toEqual([["Title", 1], ["Sub", 2]]);
  });

  it("takes the text of a heading, not its markup", () => {
    const outline = extractOutline(doc("## Use `npm ci` **now**", "", "## A ~~gone~~ [link](https://example.com)"));
    expect(outline.map((entry) => entry.text)).toEqual(["Use npm ci now", "A gone link"]);
    expect(outline.map((entry) => entry.slug)).toEqual(["use-npm-ci-now", "a-gone-link"]);
  });

  it("caps a very long outline", () => {
    const many = Array.from({ length: 300 }, (_, index) => `## Heading ${index}`).join("\n\n");
    expect(extractOutline(many)).toHaveLength(200);
  });

  it("finds CJK headings", () => {
    const outline = extractOutline(doc("## 請假流程", "", "## 加班申請"));
    expect(outline.map((entry) => entry.slug)).toEqual(["請假流程", "加班申請"]);
  });
});

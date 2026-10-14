// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { findHeading } from "@/components/knowledge/use-active-heading";

// jsdom has no CSS.escape; the ids here need none.
globalThis.CSS ??= { escape: (value: string) => value } as typeof CSS;
afterEach(() => { document.body.innerHTML = ""; });

it("finds a heading of the reader's article by its id", () => {
  document.body.innerHTML = `<div data-document-pane><article><h2 id="setup">Setup</h2></article></div>`;
  expect(findHeading("setup")?.textContent).toBe("Setup");
});

it("finds a heading in the editor by the slug the reader gives it, repeats included", () => {
  document.body.innerHTML = `<div data-document-pane><div class="kh-editor"><h2>Setup</h2><p>x</p><h3>請假 流程</h3><h2>Setup</h2></div></div>`;
  const headings = document.querySelectorAll("h2, h3");
  expect(findHeading("setup")).toBe(headings[0]);
  expect(findHeading("請假-流程")).toBe(headings[1]);
  expect(findHeading("setup-1")).toBe(headings[2]);
});

it("finds nothing outside the document pane or for a slug no heading has", () => {
  document.body.innerHTML = `<input id="tree-filter"><div data-document-pane><div class="kh-editor"><h2>Other</h2></div></div>`;
  expect(findHeading("tree-filter")).toBeNull();
  expect(findHeading("missing")).toBeNull();
});

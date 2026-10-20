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

it("finds a heading of a shared page's article, which has no document pane", () => {
  document.body.innerHTML = `<main class="kh-share-page"><nav><a id="setup-link"></a></nav><article data-review-document><h2 id="setup">Setup</h2></article></main>`;
  expect(findHeading("setup")?.textContent).toBe("Setup");
  expect(findHeading("setup-link")).toBeNull();
});

it("keeps the document pane first, and looks in no reviewed article outside a pane or a shared page", () => {
  document.body.innerHTML =
    `<main class="kh-share-page"><article data-review-document><h2 id="setup">Shared Setup</h2></article></main>` +
    `<div data-document-pane><article><h2 id="setup">Pane Setup</h2></article></div>`;
  expect(findHeading("setup")?.textContent).toBe("Pane Setup");
  document.body.innerHTML = `<article data-review-document><h2 id="setup">Elsewhere</h2></article>`;
  expect(findHeading("setup")).toBeNull();
});

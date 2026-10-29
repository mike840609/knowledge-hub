import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

/**
 * On a folder page the outline hangs between the tree rail and the article, so the room it steps
 * into must leave the rail out (folder share spec §4). That rule and the plain shared page's set the
 * same variable on the same `<main>`; the folder's must win the cascade, or the outline's margin is
 * measured from the window's edge and the rail paints over the outline (1568–1643px).
 */
it("the folder page's outline room, which leaves the rail out, wins over the plain shared page's", () => {
  const css = readFileSync("src/app/globals.css", "utf8");
  const rule = (pattern: RegExp) => {
    const match = pattern.exec(css);
    expect(match).not.toBeNull();
    return { selector: match![1].trim(), at: match!.index };
  };
  const classes = (selector: string) => (selector.match(/\.[\w-]+/g) ?? []).length;
  const folder = rule(/([^{}\n]+)\{\s*--kh-outline-room:\s*calc\(\(100vw - var\(--kh-tree-rail\)/);
  const plain = rule(/(\.kh-share-page)\s*\{\s*--kh-outline-room:/);
  expect(folder.selector).toContain(".kh-share-folder");
  const wins = classes(folder.selector) > classes(plain.selector) || (classes(folder.selector) === classes(plain.selector) && folder.at > plain.at);
  expect(wins).toBe(true);
});

/**
 * With the comments rail open beside the article, the plain shared page sets the room again, in a
 * `:has()` rule that outranks the folder's rule above. The folder page needs its own open rule that
 * still leaves the tree rail out, or opening Comments drops the subtraction and the outline's
 * margin is measured from the window's edge again.
 */
it("with the comments rail open, the folder page's outline room still leaves the rail out, and wins", () => {
  const css = readFileSync("src/app/globals.css", "utf8");
  // Classes and attribute selectors, `:has()`'s argument included: the specificity that decides here.
  const weight = (selector: string) => (selector.match(/\.[\w-]+|\[[^\]]+\]/g) ?? []).length;
  const open = ":has(.kh-review-document[data-review-inline][data-review-open])";
  const rules = [...css.matchAll(/([^{}\n]+)\{\s*--kh-outline-room:\s*([^;]+);/g)].map((match) => ({ selector: match[1].trim(), value: match[2], at: match.index! }));
  const plain = rules.find((rule) => rule.selector === `.kh-share-page${open}`);
  const folder = rules.find((rule) => rule.selector.includes(".kh-share-folder") && rule.selector.includes(open));
  expect(plain).toBeDefined();
  expect(folder).toBeDefined();
  // Both bounds the plain rule takes from the window, with the tree's column taken out of each.
  expect(folder!.value.match(/100vw - var\(--kh-tree-rail\) - theme\("maxWidth\.reading"\)/g)).toHaveLength(2);
  expect(folder!.value).toContain("- 320px");
  const wins = weight(folder!.selector) > weight(plain!.selector) || (weight(folder!.selector) === weight(plain!.selector) && folder!.at > plain!.at);
  expect(wins).toBe(true);
});

it("the folder page's pinned bar, drawn inside the body beside the tree, reaches back over the tree's column", () => {
  const css = readFileSync("src/app/globals.css", "utf8");
  expect(css).toMatch(/\.kh-share-folder-bar\s*\{\s*margin-inline-start:\s*calc\(-1 \* var\(--kh-tree-rail\)\);/);
});

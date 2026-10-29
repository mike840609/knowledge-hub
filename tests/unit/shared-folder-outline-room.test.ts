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

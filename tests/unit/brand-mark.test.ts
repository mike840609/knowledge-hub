import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** The favicon cannot inherit a colour, so it must carry each scheme's --kh-text itself (design language §13). */
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const FAVICON = read("src/app/icon.svg");
const GLOBALS = read("src/app/globals.css").replace(/\/\*[\s\S]*?\*\//g, "");

function textColour(theme: "light" | "dark"): string {
  const selector = theme === "light" ? ":root" : ':root[data-theme="dark"]';
  for (const [, blockSelector, body] of GLOBALS.matchAll(/^([^\n{}]+?)\s*\{([^{}]*)\}/gm)) {
    if (blockSelector.trim() !== selector) continue;
    const value = body.match(/--kh-text:\s*(#[0-9a-f]{6});/i)?.[1];
    if (value) return value.toLowerCase();
  }
  throw new Error(`--kh-text not found for ${theme}`);
}

describe("the favicon", () => {
  it("draws the favicon in the text colour of each scheme", () => {
    const [light, dark] = [...FAVICON.matchAll(/color:\s*(#[0-9a-f]{6})/gi)].map((match) => match[1].toLowerCase());
    expect(FAVICON).toMatch(/prefers-color-scheme:\s*dark/);
    expect(light).toBe(textColour("light"));
    expect(dark).toBe(textColour("dark"));
  });
});

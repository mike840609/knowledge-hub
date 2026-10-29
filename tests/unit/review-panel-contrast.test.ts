import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The discussion panel draws from the token layer only, so its dark mode is the theme's problem.
 * These are the pairs it actually uses; both themes must keep every one legible.
 */
const css = readFileSync("src/app/globals.css", "utf8");

function luminance(hex: string) {
  const channels = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(a: string, b: string) {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const themes = {
  light: css.split(":root {")[1].split("}")[0],
  dark: css.split(':root[data-theme="dark"] {')[1].split("}")[0],
} as const;

describe.each(Object.entries(themes))("%s discussion panel", (_theme, block) => {
  const token = (name: string) => block.match(new RegExp(`--kh-${name}: (#[a-f0-9]{6})`))![1];

  it.each([
    ["text", "bg"],
    ["text-muted", "bg"],
    ["selected-text", "bg-selected"],
    ["link", "bg"],
    ["text", "bg-raised"],
  ] as const)("keeps %s legible on %s", (foreground, background) => {
    expect(contrast(token(foreground), token(background))).toBeGreaterThanOrEqual(4.5);
  });
});

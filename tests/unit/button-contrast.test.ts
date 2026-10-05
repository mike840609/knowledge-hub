import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const css = readFileSync("src/app/globals.css", "utf8");
function luminance(hex: string) {
  const channels = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
}
function contrast(a: string, b: string) {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
}
for (const [theme, block] of [["light", css.split(":root {")[1].split("}")[0]], ["dark", css.split(':root[data-theme="dark"] {')[1].split("}")[0]]] as const) {
  const token = (name: string) => block.match(new RegExp(`--kh-${name}: (#[a-f0-9]{6})`))![1];
  describe(`${theme} button contrast`, () => {
    it.each(["primary", "primary-hover", "danger-solid", "danger-solid-hover"])("keeps white text legible on %s", background => {
      expect(contrast(token("on-primary"), token(background))).toBeGreaterThanOrEqual(4.5);
    });
    it.each(["bg", "bg-hover"])("keeps the secondary control boundary visible on %s", background => {
      expect(contrast(token("border-strong"), token(background))).toBeGreaterThanOrEqual(3);
    });
  });
}

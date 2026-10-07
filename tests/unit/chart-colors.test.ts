import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Chart colour (design language §8): series marks are drawn from the chart tokens, which must stay
 * visible as graphical objects (WCAG 1.4.11, 3:1) on the surfaces a bar sits on, and must not be
 * redeclared by a component. Read from the stylesheets themselves so the test cannot drift from
 * what ships.
 */
const CSS = readFileSync(new URL("../../src/app/globals.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const PROFILE_CSS = readFileSync(new URL("../../src/components/personal/profile.module.css", import.meta.url), "utf8");

const TOKENS = ["--kh-chart-1", "--kh-chart-1-hover", "--kh-chart-2", "--kh-chart-3"];
/** The canvas a chart sits on, and the track an unfilled bar shows. */
const SURFACES = ["--kh-bg", "--kh-bg-subtle"];
const THEMES = ["light", "dark"] as const;

function properties(theme: (typeof THEMES)[number]): Record<string, string> {
  const selector = theme === "light" ? ":root" : ':root[data-theme="dark"]';
  const found: Record<string, string> = {};
  for (const [, blockSelector, body] of CSS.matchAll(/^([^\n{}]+?)\s*\{([^{}]*)\}/gm)) {
    if (blockSelector.trim() !== selector) continue;
    for (const [, name, value] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) found[name] = value.trim();
  }
  return found;
}

function luminance(hex: string): number {
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}
function contrast(a: string, b: string): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

describe("the chart tokens", () => {
  it.each(THEMES)("are all defined in the %s theme, as six-digit hex", (theme) => {
    const declared = properties(theme);
    for (const name of TOKENS) expect(declared[name], `${name} in ${theme}`).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("are the same four in both themes, and no others", () => {
    for (const theme of THEMES) {
      expect(Object.keys(properties(theme)).filter((name) => name.startsWith("--kh-chart-")).sort()).toEqual([...TOKENS].sort());
    }
  });

  it.each(THEMES)("meet 3:1 against every surface a chart sits on in the %s theme", (theme) => {
    const declared = properties(theme);
    for (const token of TOKENS) {
      for (const surface of SURFACES) {
        expect(contrast(declared[token], declared[surface]), `${token} on ${surface} (${theme})`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it.each(THEMES)("give the hovered column a visible step from its resting colour in the %s theme", (theme) => {
    const declared = properties(theme);
    expect(contrast(declared["--kh-chart-1"], declared["--kh-chart-1-hover"])).toBeGreaterThan(1.1);
  });
});

describe("Insights", () => {
  it("takes its series colours from the chart tokens and declares none of its own", () => {
    expect(PROFILE_CSS).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    for (const token of TOKENS) expect(PROFILE_CSS).toContain(`var(${token})`);
  });
});

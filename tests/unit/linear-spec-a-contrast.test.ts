// tests/unit/linear-spec-a-contrast.test.ts
import { describe, expect, it } from "vitest";
import fs from "node:fs";

function darkBlock(): string {
  const css = fs.readFileSync("src/app/globals.css", "utf8");
  const start = css.indexOf(':root[data-theme="dark"]');
  return css.slice(start, css.indexOf("}", css.indexOf("--kh-shadow-modal", start)) + 1);
}

describe("spec A2 dark ramp + borders", () => {
  it("canvas is near-black", () => {
    expect(darkBlock()).toContain("--kh-bg: #08090a");
  });
  it("borders are translucent white, not solid", () => {
    const block = darkBlock();
    expect(block).toContain("rgba(255, 255, 255, 0.08)");
    expect(block).not.toContain("--kh-border: #");
  });
});

/** Custom properties declared in the dark block, e.g. { "--kh-bg": "#08090a" }. */
function darkProps(): Record<string, string> {
  const found: Record<string, string> = {};
  for (const [, name, value] of darkBlock().matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) found[name] = value.trim();
  return found;
}

function hexChannels(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

function channelLuminance(channel: number): number {
  const v = channel / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2.x relative luminance of an sRGB colour given as channels. */
function luminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

/** CIE L* (D65) from relative luminance — same scale the audit's finding 18 used. */
function star(lum: number): number {
  const f = lum > 0.008856 ? Math.cbrt(lum) : 7.787 * lum + 16 / 116;
  return 116 * f - 16;
}

/** White overlay at `alpha` composited over an opaque hex surface. */
function compositeWhiteOver(alpha: number, bgHex: string): [number, number, number] {
  return hexChannels(bgHex).map((v) => Math.round(alpha * 255 + (1 - alpha) * v)) as [number, number, number];
}

function parseWhiteAlpha(value: string): number {
  const m = value.match(/rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*([\d.]+)\s*\)/);
  if (!m) throw new Error(`not a translucent-white rgba: ${value}`);
  return parseFloat(m[1]);
}

describe("spec A2 border-strong contrast gate (WCAG 1.4.11, audit finding 19 method)", () => {
  // Scripted final value: 0.28 failed on all three surfaces, stepped +0.02
  // per step — 0.30 and 0.32 still failed bg/sunken — 0.34 is the first
  // alpha where bg, subtle and sunken all clear 3:1.
  it("border-strong is the scripted 0.34 white overlay", () => {
    expect(parseWhiteAlpha(darkProps()["--kh-border-strong"])).toBeCloseTo(0.34, 5);
  });

  it.each(["--kh-bg", "--kh-bg-subtle", "--kh-bg-sunken"] as const)(
    "border-strong composited over %s reaches at least 3:1 against it",
    (surface) => {
      const props = darkProps();
      const alpha = parseWhiteAlpha(props["--kh-border-strong"]);
      expect(contrast(compositeWhiteOver(alpha, props[surface]), hexChannels(props[surface]))).toBeGreaterThanOrEqual(3);
    },
  );

  it("would be caught by the gate: the 0.28 starting alpha fails on bg", () => {
    const props = darkProps();
    expect(contrast(compositeWhiteOver(0.28, props["--kh-bg"]), hexChannels(props["--kh-bg"]))).toBeLessThan(3);
  });
});

describe("spec A2 border/hover ordering (audit finding 18: no reversal)", () => {
  it("border composite on canvas is dimmer than the hover fill", () => {
    const props = darkProps();
    const borderOnCanvas = compositeWhiteOver(parseWhiteAlpha(props["--kh-border"]), props["--kh-bg"]);
    expect(star(luminance(borderOnCanvas))).toBeLessThan(star(luminance(hexChannels(props["--kh-bg-hover"]))));
  });

  it("would be caught by the guard: a control-strength border is not dimmer than hover", () => {
    // border-strong has a different job (control boundary, WCAG 1.4.11) and
    // correctly reads brighter than the hover fill — so the ordering above
    // discriminates instead of passing for any white overlay.
    const props = darkProps();
    const strongOnCanvas = compositeWhiteOver(parseWhiteAlpha(props["--kh-border-strong"]), props["--kh-bg"]);
    expect(star(luminance(strongOnCanvas))).toBeGreaterThan(star(luminance(hexChannels(props["--kh-bg-hover"]))));
  });
});

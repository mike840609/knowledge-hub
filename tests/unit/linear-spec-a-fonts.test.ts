// tests/unit/linear-spec-a-fonts.test.ts
import { describe, expect, it } from "vitest";
import fs from "node:fs";

describe("spec A1 font tokens", () => {
  it("exposes sans + mono variables from fonts.ts", () => {
    const src = fs.readFileSync("src/app/fonts.ts", "utf8");
    expect(src).toContain("--kh-font-sans");
    expect(src).toContain("--kh-font-mono");
    expect(src).toContain("Geist_Mono");
  });
  it("enables cv01/ss03 globally", () => {
    const css = fs.readFileSync("src/app/globals.css", "utf8");
    expect(css).toContain('"cv01"');
    expect(css).toContain('"ss03"');
  });
  it("pins weight ladder to 400/510/590", () => {
    const cfg = fs.readFileSync("tailwind.config.ts", "utf8");
    expect(cfg).toContain("510");
    expect(cfg).toContain("590");
    expect(cfg).not.toContain("700");
  });
});

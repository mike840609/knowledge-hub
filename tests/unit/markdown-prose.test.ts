import { describe, expect, it } from "vitest";
import config from "../../tailwind.config";
import { MARKDOWN_PROSE } from "@/components/knowledge/markdown-prose";

// docs/superpowers/specs/2026-10-20-reader-measure-and-heading-scale-design.md
const classes = MARKDOWN_PROSE.split(/\s+/);
const fontSize = (config.theme as { fontSize: Record<string, [string, { lineHeight: string }]> }).fontSize;

describe("the prose measure", () => {
  it("holds running text to the measure", () => {
    expect(classes).toContain("[&_:is(p,ul,ol,dl,blockquote,h1,h2,h3,h4,h5,h6)]:max-w-measure");
  });

  it("leaves tables and code the whole reading column", () => {
    expect(classes.filter((name) => name.includes("max-w-"))).toEqual(["[&_:is(p,ul,ol,dl,blockquote,h1,h2,h3,h4,h5,h6)]:max-w-measure"]);
  });
});

describe("the heading scale", () => {
  it.each([
    ["h1", "text-display"],
    ["h2", "text-heading"],
    ["h3", "text-subheading"],
    ["h4", "text-reading"],
    ["h5", "text-reading"],
    ["h6", "text-reading"],
  ])("sets %s in %s, semibold", (level, size) => {
    expect(classes).toContain(`[&_${level}]:${size}`);
    expect(classes).toContain(`[&_${level}]:font-semibold`);
  });

  it("sets no heading in a UI size smaller than body text", () => {
    for (const level of ["h1", "h2", "h3", "h4", "h5", "h6"]) {
      const size = classes.find((name) => name.startsWith(`[&_${level}]:text-`) && name.slice(`[&_${level}]:text-`.length) in fontSize)!;
      expect(parseInt(fontSize[size.slice(`[&_${level}]:text-`.length)][0])).toBeGreaterThanOrEqual(parseInt(fontSize.reading[0]));
    }
  });

  it("tells h6 from h5 by colour", () => {
    expect(classes).toContain("[&_h6]:text-kh-text-muted");
  });

  it("has a 17px heading step on the 2px grid", () => {
    expect(fontSize.subheading[0]).toBe("17px");
    expect(fontSize.subheading[1].lineHeight).toBe("26px");
  });
});

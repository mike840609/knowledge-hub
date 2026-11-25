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
  ])("sets %s in %s", (level, size) => {
    expect(classes).toContain(`[&_${level}]:${size}`);
  });

  // 20px and 17px alone read as one level (editor page polish spec, decision 4): H2 is also set off
  // by more room above it and H3 is lighter, inside the existing tokens.
  it.each(["h1", "h2", "h4", "h5", "h6"])("sets %s semibold", (level) => {
    expect(classes).toContain(`[&_${level}]:font-semibold`);
  });

  it("tells h3 from h2 by weight and by the room above", () => {
    expect(classes).toContain("[&_h3]:font-medium");
    expect(classes).not.toContain("[&_h3]:font-semibold");
    expect(classes).toContain("[&_h2]:mt-8");
    expect(classes).toContain("[&_h3]:mt-5");
  });

  it("hangs a to-do's native box in the gutter, as the editor's drawn box is", () => {
    expect(classes).toContain("[&_li.task-list-item_input]:absolute");
    expect(classes).toContain("[&_li.task-list-item_input]:left-[var(--kh-task-left)]");
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

describe("inline code", () => {
  it("is a chip only outside a code block, where its padding would indent the block's first line", () => {
    expect(classes.filter((name) => name.startsWith("[&_code]"))).toEqual([]);
    expect(classes).toContain("[&_:not(pre)>code]:px-1");
  });
});

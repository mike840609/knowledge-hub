import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Illustration } from "@/components/knowledge/illustration";

const kinds = ["start", "sources", "search", "shares", "discussions", "insights", "updates", "graph", "context", "reading"] as const;

describe("empty-state illustrations", () => {
  it.each(kinds)("draws %s on the shared canvas, in the shared stroke, hidden from assistive technology", (kind) => {
    const html = renderToStaticMarkup(<Illustration kind={kind} />);
    expect(html.startsWith(`<svg data-illustration="${kind}" viewBox="0 0 256 96" class="h-24 w-64 max-w-full" fill="none" stroke-width="1.5"`)).toBe(true);
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toMatch(/stroke-width="(?!1\.5")/);
  });

  it("draws the discussion example with a page, a chosen passage and a reply bubble", () => {
    const html = renderToStaticMarkup(<Illustration kind="discussions" />);
    expect((html.match(/<rect/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect((html.match(/<path/g) ?? []).length).toBeGreaterThanOrEqual(5);
    expect(html).toContain("stroke-kh-primary");
    expect(html).toContain("fill-kh-bg-selected");
    expect(html).not.toMatch(/<text/);
  });

  it("lets the drawing carry the meaning: no caption, and words only where a step needs naming", () => {
    for (const kind of kinds) {
      const html = renderToStaticMarkup(<Illustration kind={kind} />);
      expect(html).not.toMatch(/figcaption|Example:/);
      expect([...html.matchAll(/<text[^>]*>([^<]*)</g)].map(([, word]) => word)).toEqual(kind === "sources" ? [".md", "Local folder", "Preview", "Apply"] : []);
    }
  });

  it("draws the two ways in the order the buttons below offer them, centred on the hairline between them", () => {
    const widths = { imported: 119, written: 98 };
    for (const importFirst of [true, false]) {
      const html = renderToStaticMarkup(<Illustration kind="start" importFirst={importFirst} />);
      // A lane is the last lane group opened before its badge: the lock's shackle (read-only) or the pencil (editable).
      const lane = (badge: string) => {
        const at = html.indexOf(badge);
        return Number([...html.matchAll(/translate\(([\d.]+) 0\)/g)].filter((match) => match.index! < at).at(-1)![1]);
      };
      const imported = lane("a2.5 2.5"), written = lane("5.5-5.5 2.5 2.5");
      const divider = Number(html.match(/d="M([\d.]+) 28v46"/)![1]);
      const [first, second] = importFirst ? (["imported", "written"] as const) : (["written", "imported"] as const);
      const x = { imported, written };
      expect(x[first], `${first} leads`).toBeLessThan(x[second]);
      // The same gap either side of the hairline, and the same margin either side of the pair.
      expect(divider - (x[first] + widths[first])).toBe(x[second] - divider);
      expect(x[first]).toBe(256 - (x[second] + widths[second]));
      expect(x[first]).toBeGreaterThanOrEqual(0);
    }
  });

  it("keeps every coordinate inside the canvas", () => {
    for (const kind of kinds) {
      const html = renderToStaticMarkup(<Illustration kind={kind} />);
      const at = (name: string) => [...html.matchAll(new RegExp(` ${name}="(-?[\\d.]+)"`, "g"))].map(([, value]) => Number(value));
      // The start lanes are placed by translate; their horizontal bounds are checked by the lane test above.
      const shift = kind === "start" ? -Infinity : 0;
      for (const value of [...at("x"), ...at("cx")]) { expect(value, kind).toBeGreaterThanOrEqual(0); expect(value + shift, kind).toBeLessThanOrEqual(256); }
      for (const value of [...at("y"), ...at("cy")]) expect(value, kind).toBeLessThanOrEqual(96);
      const rects = [...html.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)].map((match) => match.slice(1).map(Number));
      for (const [x, y, width, height] of rects) { expect(x + width + shift, kind).toBeLessThanOrEqual(256); expect(y + height, kind).toBeLessThanOrEqual(96); }
      const circles = [...html.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"/g)].map((match) => match.slice(1).map(Number));
      for (const [cx, cy, r] of circles) { expect(cx + r + shift, kind).toBeLessThanOrEqual(256); expect(cy + r, kind).toBeLessThanOrEqual(96); }
    }
  });
});

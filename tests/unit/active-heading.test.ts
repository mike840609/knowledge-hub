import { describe, expect, it } from "vitest";
import { pickActiveIndex } from "@/components/knowledge/use-active-heading";

describe("pickActiveIndex", () => {
  it("has nothing to pick without headings", () => {
    expect(pickActiveIndex([], false)).toBe(-1);
    expect(pickActiveIndex([], true)).toBe(-1);
  });

  it("starts on the first heading before any has reached the reading line", () => {
    expect(pickActiveIndex([300, 900, 1500], false)).toBe(0);
  });

  it("is the last heading that has reached the line", () => {
    expect(pickActiveIndex([-800, 40, 700], false)).toBe(1);
    expect(pickActiveIndex([-1500, -700, 60], false)).toBe(2);
  });

  it("stays on a heading through a section longer than the pane", () => {
    // Nothing is on screen at all, and the section still belongs to `1`.
    expect(pickActiveIndex([-4000, -2500, 3200], false)).toBe(1);
  });

  it("treats a heading exactly on the line as reached", () => {
    expect(pickActiveIndex([-50, 96, 400], false)).toBe(1);
  });

  it("is the last heading at the bottom, even one that never reached the line", () => {
    expect(pickActiveIndex([-900, -200, 500], true)).toBe(2);
  });

  it("takes an explicit reading line", () => {
    expect(pickActiveIndex([0, 150, 300], false, 200)).toBe(1);
  });
});

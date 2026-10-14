import { describe, expect, it } from "vitest";
import { NAV_WIDTH, clampNavWidth, isNavWidth, nextNavWidth } from "@/components/shell/nav-width";

describe("sidebar width", () => {
  it("defaults to 256 within 220–400", () => {
    expect(NAV_WIDTH).toEqual({ min: 220, max: 400, default: 256, step: 16 });
  });

  it("clamps a dragged width to the bounds and rounds it", () => {
    expect(clampNavWidth(100)).toBe(220);
    expect(clampNavWidth(999)).toBe(400);
    expect(clampNavWidth(300.6)).toBe(301);
    expect(clampNavWidth(220)).toBe(220);
    expect(clampNavWidth(400)).toBe(400);
  });

  it("accepts only a finite stored number inside the bounds", () => {
    expect(isNavWidth(256)).toBe(true);
    expect(isNavWidth(220)).toBe(true);
    expect(isNavWidth(400)).toBe(true);
    for (const bad of [219, 401, Number.NaN, Number.POSITIVE_INFINITY, "256", null, undefined, {}]) {
      expect(isNavWidth(bad)).toBe(false);
    }
  });

  it("steps 16px with the arrow keys and stops at the bounds", () => {
    expect(nextNavWidth(256, "ArrowRight")).toBe(272);
    expect(nextNavWidth(256, "ArrowLeft")).toBe(240);
    expect(nextNavWidth(396, "ArrowRight")).toBe(400);
    expect(nextNavWidth(224, "ArrowLeft")).toBe(220);
  });

  it("ignores every other key", () => {
    for (const key of ["ArrowUp", "ArrowDown", "Enter", " ", "a"]) expect(nextNavWidth(256, key)).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import config from "../../tailwind.config";

/**
 * §3 says the scales are replaced, not extended, so an off-scale spelling
 * compiles to nothing. That property is what makes the contract binding, and
 * nothing checked it: a scale moved under `extend` would keep every old
 * spelling working and the only symptom would be drift nobody notices.
 */
const theme = config.theme as Record<string, unknown>;
const extended = (theme.extend ?? {}) as Record<string, unknown>;

describe("token scales", () => {
  it("replaces every scale the contract names rather than extending it", () => {
    for (const scale of [
      "fontSize",
      "borderRadius",
      "boxShadow",
      "transitionDuration",
      "transitionTimingFunction",
      "maxWidth",
    ]) {
      expect(theme, `${scale} must be replaced`).toHaveProperty(scale);
      expect(extended, `${scale} must not also be extended`).not.toHaveProperty(scale);
    }
  });

  it("names one container per job and nothing else", () => {
    // Five widths were in use for what was mostly the same page. Adding a
    // sixth is a change to the contract, so it should fail here first.
    expect(Object.keys(theme.maxWidth as object).sort()).toEqual(
      ["full", "none", "page", "panel", "reading", "wide"],
    );
  });

  it("keeps the containers in the order the contract states", () => {
    const widths = theme.maxWidth as Record<string, string>;
    expect(widths.panel).toBe("36rem");
    expect(widths.reading).toBe("860px");
    expect(widths.page).toBe("56rem");
    expect(widths.wide).toBe("64rem");
  });

  it("still carries the control ladder's three rungs in the type scale", () => {
    // A cheap canary: if fontSize were ever extended instead of replaced this
    // would keep passing, which is why the first case exists as well.
    expect(Object.keys(theme.fontSize as object)).toContain("body");
  });
});

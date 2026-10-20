import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { comparisonDir } from "../e2e/fixtures/ui-comparisons";

/**
 * `docs/ui-comparisons/` holds before/after evidence from the PRs that made it, tracked in Git. A browser test
 * that wrote there by default rewrote 25 tracked PNGs on every full run, to be restored by hand before each
 * commit (and committed by mistake when that was forgotten). Writing there is now asked for, not a side effect.
 */
describe("comparisonDir", () => {
  it("writes to the ignored test-results by default", () => {
    expect(comparisonDir("mvp-freshness", {})).toBe(path.resolve("test-results/ui-comparisons/mvp-freshness"));
  });

  it("writes the tracked evidence only when asked to", () => {
    expect(comparisonDir("mvp-freshness", { KM_UPDATE_UI_COMPARISONS: "1" })).toBe(path.resolve("docs/ui-comparisons/mvp-freshness"));
    expect(comparisonDir("mvp-freshness", { KM_UPDATE_UI_COMPARISONS: "0" })).toBe(path.resolve("test-results/ui-comparisons/mvp-freshness"));
  });
});

describe("browser tests", () => {
  const dir = path.resolve("tests/e2e");
  const specs = readdirSync(dir).filter((name) => name.endsWith(".spec.ts"));

  it.each(specs)("%s does not name the tracked comparisons directly", (name) => {
    expect(readFileSync(path.join(dir, name), "utf8")).not.toContain("docs/ui-comparisons");
  });
});

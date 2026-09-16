import { describe, expect, it } from "vitest";
import { firstSearchParam } from "@/lib/search-params";

describe("firstSearchParam", () => {
  it("passes a single string value through unchanged", () => {
    expect(firstSearchParam("a")).toBe("a");
  });

  it("takes the first value when Next.js delivers a repeated query key as an array", () => {
    expect(firstSearchParam(["a", "b"])).toBe("a");
  });

  it("returns undefined for a missing value", () => {
    expect(firstSearchParam(undefined)).toBeUndefined();
  });

  it("returns undefined for an empty array", () => {
    expect(firstSearchParam([])).toBeUndefined();
  });
});

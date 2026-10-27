// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { THEME_PRE_PAINT_SCRIPT } from "@/app/theme-script";

/**
 * The head script decides the rails' density before first paint: compact unless comfortable was chosen,
 * and compact whenever storage cannot answer, without disturbing the theme it also stamps.
 */
function runScript() {
  new Function(THEME_PRE_PAINT_SCRIPT)();
  const { theme, density } = document.documentElement.dataset;
  return { theme, density };
}

afterEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.density;
  vi.restoreAllMocks();
});

describe("pre-paint density", () => {
  it("is compact before anyone has chosen", () => {
    expect(runScript()).toEqual({ theme: "light", density: "compact" });
  });

  it("is comfortable once chosen, alongside a chosen theme", () => {
    localStorage.setItem("kh:density", "comfortable");
    localStorage.setItem("kh:theme", "dark");
    expect(runScript()).toEqual({ theme: "dark", density: "comfortable" });
  });

  it("treats a value it does not know as compact", () => {
    localStorage.setItem("kh:density", "cozy");
    expect(runScript().density).toBe("compact");
  });

  it("falls back to light and compact when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(runScript()).toEqual({ theme: "light", density: "compact" });
  });
});

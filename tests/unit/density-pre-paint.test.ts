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

  it("resolves System from the OS before paint", () => {
    localStorage.setItem("kh:theme", "system");
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
    expect(runScript().theme).toBe("dark");
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
    expect(runScript().theme).toBe("light");
  });

  it("keeps an explicit theme even when the OS disagrees", () => {
    localStorage.setItem("kh:theme", "light");
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
    expect(runScript().theme).toBe("light");
    localStorage.setItem("kh:theme", "dark");
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
    expect(runScript().theme).toBe("dark");
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

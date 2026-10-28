import { describe, expect, it } from "vitest";
import { DEFAULT_THEME_CHOICE, isThemeChoice, resolveTheme } from "@/lib/theme";

describe("theme choice", () => {
  it("starts light until someone chooses otherwise", () => {
    expect(DEFAULT_THEME_CHOICE).toBe("light");
  });

  it("accepts only the three choices the menu offers", () => {
    expect(isThemeChoice("light")).toBe(true);
    expect(isThemeChoice("dark")).toBe(true);
    expect(isThemeChoice("system")).toBe(true);
    expect(isThemeChoice("sepia")).toBe(false);
    expect(isThemeChoice(null)).toBe(false);
  });

  it("keeps an explicit choice even when the system disagrees", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("follows the system only when System is chosen", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });
});

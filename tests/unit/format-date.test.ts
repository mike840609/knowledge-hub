import { describe, expect, it } from "vitest";
import { UI_LOCALE, formatDate, formatDateTime, formatRelativeTime } from "@/lib/format-date";

/**
 * Four call sites each built their own `Intl` formatter with the locale
 * spelled inline, so "change the locale" meant finding all of them. These
 * assert the one place exists and that its output is shaped as documented.
 */
describe("format-date", () => {
  const when = new Date("2026-03-04T09:05:00Z");

  it("exposes one locale for the whole UI", () => {
    expect(UI_LOCALE).toBe("en-US");
  });

  it("formats a date with and without its time", () => {
    expect(formatDateTime(when)).toMatch(/Mar 4, 2026/);
    expect(formatDateTime(when)).toMatch(/\d:\d\d/);
    expect(formatDate(when)).toMatch(/Mar 4, 2026/);
    expect(formatDate(when)).not.toMatch(/\d:\d\d/);
  });

  it("picks the coarsest useful unit for a relative time", () => {
    expect(formatRelativeTime(30_000)).toBe("just now");
    expect(formatRelativeTime(5 * 60_000)).toBe("5 minutes ago");
    expect(formatRelativeTime(3 * 3_600_000)).toBe("3 hours ago");
    expect(formatRelativeTime(2 * 86_400_000)).toBe("2 days ago");
  });

  it("reads the boundaries the way the header did", () => {
    expect(formatRelativeTime(60_000)).toBe("1 minute ago");
    expect(formatRelativeTime(3_600_000)).toBe("1 hour ago");
    expect(formatRelativeTime(86_400_000)).toBe("yesterday");
  });
});

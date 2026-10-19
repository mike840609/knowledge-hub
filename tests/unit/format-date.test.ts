import { describe, expect, it } from "vitest";
import { SSR_TIME_ZONE, UI_LOCALE, formatDate, formatDateTime, formatRelativeTime, formatShortTime } from "@/lib/format-date";

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
    expect(formatDateTime(when, "UTC")).toMatch(/Mar 4, 2026/);
    expect(formatDateTime(when, "UTC")).toMatch(/\d:\d\d/);
    expect(formatDate(when, "UTC")).toMatch(/Mar 4, 2026/);
    expect(formatDate(when, "UTC")).not.toMatch(/\d:\d\d/);
  });

  /**
   * The zone is a required argument because leaving it to the runtime is the
   * bug: three of the six render sites were server components, so the
   * server's zone was what a reader in Asia/Taipei saw and kept.
   */
  it("renders the same instant differently in different zones", () => {
    expect(formatDateTime(when, "UTC")).toBe("Mar 4, 2026, 9:05 AM");
    expect(formatDateTime(when, "Asia/Taipei")).toBe("Mar 4, 2026, 5:05 PM");
    // A zone can cross the date boundary, which is why the date form takes one too.
    expect(formatDate(new Date("2026-03-04T17:00:00Z"), "UTC")).toBe("Mar 4, 2026");
    expect(formatDate(new Date("2026-03-04T17:00:00Z"), "Asia/Taipei")).toBe("Mar 5, 2026");
  });

  it("agrees on one zone for the render the server and the client share", () => {
    expect(SSR_TIME_ZONE).toBe("UTC");
  });

  it("falls back to that zone rather than throwing on one it does not know", () => {
    expect(formatDateTime(when, "Mars/Olympus_Mons")).toBe(formatDateTime(when, SSR_TIME_ZONE));
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

describe("formatShortTime", () => {
  const now = Date.parse("2026-10-19T12:00:00Z");
  const ago = (ms: number) => formatShortTime(new Date(now - ms), now, "UTC");
  const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;

  it("counts minutes, hours and days in one letter, the coarsest unit that fits", () => {
    expect(ago(0)).toBe("now");
    expect(ago(MIN - 1)).toBe("now");
    expect(ago(MIN)).toBe("1m");
    expect(ago(HOUR - 1)).toBe("59m");
    expect(ago(HOUR)).toBe("1h");
    expect(ago(DAY - 1)).toBe("23h");
    expect(ago(DAY)).toBe("1d");
    expect(ago(7 * DAY - 1)).toBe("6d");
  });

  it("names the date from a week on, with the year only when it is not this one", () => {
    expect(ago(7 * DAY)).toBe("Oct 12");
    expect(formatShortTime(new Date("2025-12-30T00:00:00Z"), now, "UTC")).toBe("Dec 30, 2025");
  });

  it("treats a time in the future as now", () => {
    expect(ago(-5 * MIN)).toBe("now");
  });

  it("decides the year in the reader's zone", () => {
    const newYear = Date.parse("2027-01-01T03:00:00Z");
    // 2026-12-24 in New York is still last year there and here alike; Dec 31 23:00 UTC is Jan 1 in Tokyo.
    expect(formatShortTime(new Date("2026-12-24T23:00:00Z"), newYear, "Asia/Tokyo")).toBe("Dec 25, 2026");
    expect(formatShortTime(new Date("2026-12-24T23:00:00Z"), newYear, "UTC")).toBe("Dec 24, 2026");
  });
});


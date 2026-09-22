import { describe, expect, it } from "vitest";
import { SSR_TIME_ZONE, UI_LOCALE, formatDate, formatDateTime, formatRelativeTime } from "@/lib/format-date";

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

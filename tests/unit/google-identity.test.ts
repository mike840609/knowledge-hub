import { describe, expect, it } from "vitest";
import { googleDisplayName, googleEmpId } from "@/server/google-identity";

describe("googleEmpId", () => {
  it("is deterministic, prefixed, and unique per subject", () => {
    const first = googleEmpId("google-subject-1");
    expect(first).toMatch(/^DEMO-[0-9A-F]{10}$/);
    expect(googleEmpId("google-subject-1")).toBe(first);
    expect(googleEmpId("google-subject-2")).not.toBe(first);
  });
});

describe("googleDisplayName", () => {
  it("uses the trimmed Google name first", () => {
    expect(googleDisplayName("  Wang Xiaoming  ", "wm@example.com")).toBe("Wang Xiaoming");
  });
  it("falls back to the email local-part", () => {
    expect(googleDisplayName("", "wm@example.com")).toBe("wm");
  });
  it("falls back to Demo user and caps at 512 characters", () => {
    expect(googleDisplayName("", "")).toBe("Demo user");
    expect(googleDisplayName("x".repeat(600), "a@example.com")).toHaveLength(512);
  });
});

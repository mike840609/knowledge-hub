import { describe, expect, it } from "vitest";
import { googleGate, isGooglePublicPath, safeReturnTo } from "@/lib/auth-paths";

describe("isGooglePublicPath", () => {
  it.each([
    "/login",
    "/api/auth/callback/google",
    "/api/health",
    "/api/share-review/threads/x",
    "/sample-wiki/manifest.json",
    "/s",
    "/s/token",
  ])("is public: %s", (path) => {
    expect(isGooglePublicPath(path)).toBe(true);
  });

  it.each(["/", "/w/ws/home", "/api/documents/x", "/s/token/open", "/s/token/other"])("is protected: %s", (path) => {
    expect(isGooglePublicPath(path)).toBe(false);
  });
});

describe("safeReturnTo", () => {
  it.each(["/", "/w/ws/home", "/w/ws/knowledge/source/doc", "/s/token", "/s/token/open"])("accepts %s", (value) => {
    expect(safeReturnTo(value)).toBe(value);
  });

  it.each([null, "", "https://evil.example", "//evil.example", "/w/../admin", "/login", "/api/documents/x"])("falls back to / for %s", (value) => {
    expect(safeReturnTo(value)).toBe("/");
  });
});

describe("googleGate", () => {
  it("allows public paths without a session", () => {
    expect(googleGate({ pathname: "/s/token", search: "", hasSession: false })).toEqual({ kind: "allow" });
  });

  it("returns 401 for protected APIs without a session", () => {
    expect(googleGate({ pathname: "/api/documents/x", search: "", hasSession: false })).toEqual({ kind: "unauthorized" });
  });

  it("redirects a protected page and preserves a safe /s returnTo", () => {
    expect(googleGate({ pathname: "/", search: "?returnTo=/s/token", hasSession: false })).toEqual({
      kind: "redirect",
      location: "/login?returnTo=%2Fs%2Ftoken",
    });
    expect(googleGate({ pathname: "/s/token/open", search: "", hasSession: false })).toEqual({
      kind: "redirect",
      location: "/login?returnTo=%2Fs%2Ftoken%2Fopen",
    });
  });

  it("drops an unsafe returnTo", () => {
    expect(googleGate({ pathname: "/", search: "?returnTo=https%3A%2F%2Fevil.example", hasSession: false })).toEqual({
      kind: "redirect",
      location: "/login?returnTo=%2F",
    });
  });

  it("allows a session through", () => {
    expect(googleGate({ pathname: "/w/ws/home", search: "", hasSession: true })).toEqual({ kind: "allow" });
  });
});

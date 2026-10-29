import { describe, expect, it } from "vitest";
import { googleGate, isGooglePublicPath, isSharedReturn, safeReturnTo } from "@/lib/auth-paths";

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

const uuid = "0192f3a4-5b6c-7d8e-9f01-23456789abcd";

// A folder link's page names the document it shows in `?d=`; a return to it keeps exactly that and nothing else (folder share spec §4).
describe("returning to a shared folder page", () => {
  const accepted = ["/s/token", "/s/token/open", `/s/token?d=${uuid}`, `/s/token/open?d=${uuid}`];
  const refused = ["/s/token?d=x", `/s/token?d=${uuid}&e=1`, `/s/token/d/${uuid}`, `/s/token?d=${uuid}#x`, `/s/token?e=${uuid}`, `/s/token?d=${uuid.toUpperCase()}`, `/s/token/other?d=${uuid}`, "/s/token?d="];

  it.each(accepted)("SHARED_RETURN accepts %s", (value) => {
    expect(isSharedReturn(value)).toBe(true);
    expect(safeReturnTo(value)).toBe(value);
  });

  it.each(refused)("SHARED_RETURN refuses %s", (value) => {
    expect(isSharedReturn(value)).toBe(false);
    expect(safeReturnTo(value)).toBe("/");
  });

  it("the sign-in exemption stays the path alone: a query never reaches it, and `/open` stays protected", () => {
    expect(isGooglePublicPath(`/s/token?d=${uuid}`)).toBe(false);
    expect(googleGate({ pathname: "/s/token", search: `?d=${uuid}`, hasSession: false })).toEqual({ kind: "allow" });
    expect(isGooglePublicPath("/s/token/open")).toBe(false);
  });

  it("a sign-in on the way to `/open?d=` comes back to the same document", () => {
    expect(googleGate({ pathname: "/s/token/open", search: `?d=${uuid}`, hasSession: false })).toEqual({
      kind: "redirect",
      location: `/login?returnTo=${encodeURIComponent(`/s/token/open?d=${uuid}`)}`,
    });
  });

  it("any other query on `/open` is dropped, not carried into the return", () => {
    expect(googleGate({ pathname: "/s/token/open", search: "?d=x&next=https://evil.test", hasSession: false })).toEqual({
      kind: "redirect",
      location: "/login?returnTo=%2Fs%2Ftoken%2Fopen",
    });
  });
});

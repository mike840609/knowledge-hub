import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { isSitePasswordExempt, verifySitePassword } from "@/lib/site-password";
import { config, middleware } from "@/middleware";

const basic = (value: string) => `Basic ${btoa(value)}`;

afterEach(() => vi.unstubAllEnvs());

describe("isSitePasswordExempt", () => {
  it.each(["/s", "/s/abc", "/s/abc/open", "/api/share-review", "/api/share-review/threads/query", "/api/health"])("exempts %s", (path) => {
    expect(isSitePasswordExempt(path)).toBe(true);
  });
  it.each(["/", "/w/ws/home", "/api/documents/x", "/sx", "/api/healthz"])("requires auth for %s", (path) => {
    expect(isSitePasswordExempt(path)).toBe(false);
  });
});

describe("verifySitePassword", () => {
  it("accepts the configured password with any username", async () => {
    expect(await verifySitePassword(basic("owner:s3cret"), "s3cret")).toBe(true);
  });
  it("rejects a wrong password, a missing header, and a non-Basic scheme", async () => {
    expect(await verifySitePassword(basic("owner:wrong"), "s3cret")).toBe(false);
    expect(await verifySitePassword(null, "s3cret")).toBe(false);
    expect(await verifySitePassword("Bearer s3cret", "s3cret")).toBe(false);
  });
  it("rejects malformed base64 without throwing", async () => {
    expect(await verifySitePassword("Basic !!!", "s3cret")).toBe(false);
  });
  it("handles a password containing a colon", async () => {
    expect(await verifySitePassword(basic("owner:a:b"), "a:b")).toBe(true);
  });
  it("accepts a UTF-8 password, as the challenge advertises", async () => {
    const encoded = btoa(String.fromCharCode(...new TextEncoder().encode("owner:päss")));
    expect(await verifySitePassword(`Basic ${encoded}`, "päss")).toBe(true);
  });
});

describe("middleware", () => {
  it("returns 401 with a Basic challenge when the password is set and absent", async () => {
    vi.stubEnv("KM_SITE_PASSWORD", "s3cret");
    const response = await middleware(new NextRequest("https://km.example.com/w/ws/home"));
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain('Basic realm="Knowledge Hub"');
  });

  it("lets an authenticated page through with its CSP header", async () => {
    vi.stubEnv("KM_SITE_PASSWORD", "s3cret");
    const response = await middleware(new NextRequest("https://km.example.com/w/ws/home", { headers: { authorization: basic("owner:s3cret") } }));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toContain("script-src");
  });

  it("gates API routes but does not attach a page CSP to them", async () => {
    vi.stubEnv("KM_SITE_PASSWORD", "s3cret");
    const response = await middleware(new NextRequest("https://km.example.com/api/documents/x", { headers: { authorization: basic("owner:s3cret") } }));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toBeNull();
  });

  it("leaves everything alone when no password is configured", async () => {
    vi.stubEnv("KM_SITE_PASSWORD", "");
    const response = await middleware(new NextRequest("https://km.example.com/api/documents/x"));
    expect(response.status).toBe(200);
  });

  it("lets share pages and the share-review API through without credentials", async () => {
    vi.stubEnv("KM_SITE_PASSWORD", "s3cret");
    for (const url of ["https://km.example.com/s/abc", "https://km.example.com/api/share-review/threads/query"]) {
      const response = await middleware(new NextRequest(url));
      expect(response.status).toBe(200);
    }
  });
});

describe("middleware matcher", () => {
  const pattern = new RegExp(`^${config.matcher[0]}$`);

  it.each(["/api/documents/x", "/api/health", "/api/share-review/threads/query", "/w/ws/home", "/s/abc"])("covers %s", (path) => {
    expect(pattern.test(path)).toBe(true);
  });

  it.each(["/_next/static/x.js", "/_next/image", "/icon.svg", "/icons/a.svg"])("skips %s", (path) => {
    expect(pattern.test(path)).toBe(false);
  });
});

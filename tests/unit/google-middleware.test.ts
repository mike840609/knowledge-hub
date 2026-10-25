import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  session: null as null | { user: { hubUserId: string; empId: string; orgCode: string; displayName: string } },
}));

vi.mock("@/auth.edge", () => ({
  googleAuth:
    (handler: (request: NextRequest & { auth: unknown }) => Response | Promise<Response>) =>
    async (request: NextRequest) =>
      handler(Object.assign(request, { auth: state.session })),
}));

import { middleware } from "@/middleware";

afterEach(() => vi.unstubAllEnvs());

function request(path: string): NextRequest {
  return new NextRequest(`https://km.example.com${path}`);
}

describe("Google middleware gate", () => {
  it("redirects a signed-out page to /login with its destination", async () => {
    vi.stubEnv("KM_IDENTITY_PROVIDER", "google");
    state.session = null;
    const response = await middleware(request("/w/ws/home"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://km.example.com/login?returnTo=%2Fw%2Fws%2Fhome");
  });

  it("returns a JSON 401 for a signed-out API", async () => {
    vi.stubEnv("KM_IDENTITY_PROVIDER", "google");
    state.session = null;
    const response = await middleware(request("/api/documents/x"));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: "AUTH_REQUIRED", message: "Sign in required." },
    });
  });

  it.each(["/login", "/s/token", "/api/health", "/api/share-review/threads/query"])(
    "allows a public path without a session: %s",
    async (path) => {
      vi.stubEnv("KM_IDENTITY_PROVIDER", "google");
      state.session = null;
      const response = await middleware(request(path));
      expect(response.status).toBe(200);
    },
  );

  it("allows a signed-in page and keeps the CSP", async () => {
    vi.stubEnv("KM_IDENTITY_PROVIDER", "google");
    state.session = { user: { hubUserId: "u1", empId: "DEMO-ABC1234567", orgCode: "DEMO", displayName: "Wang" } };
    const response = await middleware(request("/w/ws/home"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toContain("script-src");
  });
});

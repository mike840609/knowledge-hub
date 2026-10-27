import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/auth.edge", () => {
  throw new Error("Auth.js must not load for non-Google deployments");
});

import { middleware } from "@/middleware";

afterEach(() => vi.unstubAllEnvs());

describe("non-Google middleware isolation", () => {
  it("serves a local deployment without importing Auth.js", async () => {
    vi.stubEnv("KM_IDENTITY_PROVIDER", "local");
    const response = await middleware(new NextRequest("https://km.example.com/api/health"));
    expect(response.status).toBe(200);
  });
});

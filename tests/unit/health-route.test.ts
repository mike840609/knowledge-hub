import { describe, expect, it, vi } from "vitest";

const pool = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/server/composition", () => ({ getDatabasePool: () => pool }));

import { GET } from "@/app/api/health/route";
import { healthTimeoutMs, pingDatabase } from "@/server/database-health";

describe("GET /api/health", () => {
  it("answers ok when SELECT 1 succeeds", async () => {
    pool.query.mockResolvedValueOnce([{ 1: 1 }]);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(pool.query).toHaveBeenCalledWith("SELECT 1");
  });

  it("answers 503 without leaking the error when the database is unreachable", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    pool.query.mockRejectedValueOnce(new Error("connect ECONNREFUSED 10.0.0.1:3306"));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false });
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe("healthTimeoutMs", () => {
  it("follows the configured connect timeout", () => {
    vi.stubEnv("KM_DB_CONNECT_TIMEOUT_MS", "45000");
    expect(healthTimeoutMs()).toBe(45000);
    vi.unstubAllEnvs();
  });
});

describe("pingDatabase", () => {
  it("times out a query that never resolves", async () => {
    await expect(pingDatabase({ query: () => new Promise(() => {}) }, 10)).rejects.toThrow(/timed out/i);
  });
});

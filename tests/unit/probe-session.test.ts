import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("probe-session", () => {
  it.skipIf(process.platform === "win32")("exits 1 when the database is unreachable", () => {
    const result = spawnSync("./node_modules/.bin/tsx", ["scripts/db/probe-session.ts"], {
      encoding: "utf8",
      timeout: 20_000,
      env: {
        ...process.env,
        KM_DB_URL: "mysql://u:p@127.0.0.1:1/db",
        KM_DB_SSL: "off",
        KM_DB_CONNECT_TIMEOUT_MS: "1000",
        KM_DB_ACQUIRE_TIMEOUT_MS: "2000",
      },
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("FAIL");
    expect(result.stdout).toContain("Session probe failed");
  });
});

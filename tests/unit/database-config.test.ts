import { afterEach, describe, expect, it, vi } from "vitest";
import { databaseConfig, parseConnectionUrl, sslOption } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool, SESSION_INIT_SQL } from "@/infrastructure/database/mariadb/pool";

afterEach(() => vi.unstubAllEnvs());

describe("parseConnectionUrl", () => {
  it("parses a mariadb URL with an encoded password and explicit port", () => {
    expect(parseConnectionUrl("mariadb://km:p%40ss%2Fword@db.example.com:3307/hcm_km?ssl-mode=REQUIRED"))
      .toEqual({ host: "db.example.com", port: 3307, user: "km", password: "p@ss/word", database: "hcm_km" });
  });

  it("defaults the port to 3306 and accepts mysql://", () => {
    expect(parseConnectionUrl("mysql://u:p@host/db")).toEqual({ host: "host", port: 3306, user: "u", password: "p", database: "db" });
  });

  it("rejects a non-MySQL protocol without echoing the secret", () => {
    expect(() => parseConnectionUrl("postgres://u:secret@host/db")).toThrow(/mysql:\/\/ or mariadb:\/\//);
    try { parseConnectionUrl("postgres://u:secret@host/db"); } catch (error) { expect(String(error)).not.toContain("secret"); }
  });

  it("rejects a missing database name", () => {
    expect(() => parseConnectionUrl("mysql://u:p@host/")).toThrow(/database/i);
  });

  it("strips IPv6 host brackets", () => {
    expect(parseConnectionUrl("mysql://u:p@[::1]:3306/db")).toEqual({ host: "::1", port: 3306, user: "u", password: "p", database: "db" });
  });

  it("rejects a database path with extra segments or a trailing slash", () => {
    expect(() => parseConnectionUrl("mysql://u:p@host/db/")).toThrow(/database/i);
    expect(() => parseConnectionUrl("mysql://u:p@host/db/extra")).toThrow(/database/i);
  });

  it("keeps a literal @ in the password", () => {
    expect(parseConnectionUrl("mysql://u:p@ss@host/db")).toEqual({ host: "host", port: 3306, user: "u", password: "p@ss", database: "db" });
  });

  it("defaults an empty port to 3306", () => {
    expect(parseConnectionUrl("mysql://u:p@host:/db").port).toBe(3306);
  });

  it("rejects a bare percent sign without echoing the value", () => {
    expect(() => parseConnectionUrl("mysql://u:p%ss@host/db")).toThrow(/mysql:\/\/ or mariadb:\/\//);
    try { parseConnectionUrl("mysql://u:p%ss@host/db"); } catch (error) {
      expect(String(error)).not.toContain("p%ss");
      expect(String(error)).not.toContain("mysql://u:");
    }
  });
});

describe("sslOption", () => {
  it.each([["off", false], ["verify", { rejectUnauthorized: true }], ["trust", { rejectUnauthorized: false }]] as const)("maps %s", (mode, expected) => {
    expect(sslOption(mode)).toEqual(expected);
  });
  it("rejects an unknown mode", () => { expect(() => sslOption("maybe")).toThrow(/KM_DB_SSL/); });
});

describe("databaseConfig", () => {
  it("uses KM_DB_URL with verify TLS and a two-connection pool on Vercel", () => {
    vi.stubEnv("KM_DB_URL", "mysql://u:p@h:3307/db");
    vi.stubEnv("VERCEL", "1");
    expect(databaseConfig("dev")).toMatchObject({
      host: "h", port: 3307, user: "u", password: "p", database: "db",
      connectionLimit: 2, connectTimeout: 30000, acquireTimeout: 35000,
      ssl: { rejectUnauthorized: true },
    });
  });

  it("keeps the individual variables as the local fallback", () => {
    vi.stubEnv("KM_DB_URL", "");
    vi.stubEnv("KM_DB_PORT", "3307");
    vi.stubEnv("KM_DB_HOST", "127.0.0.1");
    vi.stubEnv("VERCEL", "");
    expect(databaseConfig("dev")).toMatchObject({ host: "127.0.0.1", port: 3307, connectionLimit: 10, ssl: false });
  });

  it("ignores KM_DB_URL for the test and e2e harnesses", () => {
    vi.stubEnv("KM_DB_URL", "mysql://u:p@remote/db");
    vi.stubEnv("KM_TEST_DB_HOST", "test-host");
    expect(databaseConfig("test").host).toBe("test-host");
  });
});

describe("session init", () => {
  it("pins READ COMMITTED and UTC", () => {
    expect(SESSION_INIT_SQL).toEqual([
      "SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED",
      "SET SESSION time_zone = '+00:00'",
    ]);
  });
});

describe("pool construction", () => {
  it("warns when certificate verification is disabled", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const pool = createDatabasePool({ host: "h", port: 3306, user: "u", password: "p", database: "db", ssl: { rejectUnauthorized: false } });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("KM_DB_SSL=trust"));
    const output = warn.mock.calls.flat().map(String).join(" ");
    expect(output).not.toContain("password");
    expect(output).not.toContain("mysql://");
    await pool.end();
    warn.mockRestore();
  });
});

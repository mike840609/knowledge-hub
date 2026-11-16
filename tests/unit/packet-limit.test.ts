import { afterEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "mariadb";
import { guardPool, insertBudget, knownPacketLimit, markdownFileCeiling, PacketTooLargeError, statementBytes } from "@/infrastructure/database/mariadb/packet-limit";
import { mapDatabaseError } from "@/infrastructure/database/mariadb/repositories/shared";
import { toImportErrorResponse, toWorkspaceErrorResponse } from "@/server/http-error-response";
import { ContentTooLargeError } from "@/shared/domain/errors";

const store = globalThis as { __khPacketLimit?: number };
afterEach(() => { delete store.__khPacketLimit; });

describe("statement size", () => {
  it("counts each character the driver escapes as two bytes, and UTF-8 as sent", () => {
    expect(statementBytes("SELECT ?", ["abc"])).toBe(8 + 3 + 2 + 2);
    expect(statementBytes("SELECT ?", ["\n\n'"])).toBe(8 + 6 + 2 + 2);
    expect(statementBytes("SELECT ?", ["長"])).toBe(8 + 3 + 2 + 2);
  });
  it("is never below what the driver writes for a newline-heavy body", () => {
    const body = "line\n".repeat(10_000);
    const sent = `INSERT INTO t VALUES ('${body.replace(/\n/g, "\\n")}')`;
    expect(statementBytes("INSERT INTO t VALUES (?)", [body])).toBeGreaterThanOrEqual(Buffer.byteLength(sent));
  });
  it("covers every value form the driver writes", () => {
    const buffer = Buffer.alloc(100);
    expect(statementBytes("?", [buffer])).toBeGreaterThanOrEqual(200);
    expect(statementBytes("?", [new Date()])).toBeGreaterThanOrEqual("'2026-11-16 00:00:00.000'".length);
    expect(statementBytes("?", [{ a: "x".repeat(100) }])).toBeGreaterThanOrEqual(JSON.stringify({ a: "x".repeat(100) }).length + 2);
    expect(statementBytes("IN (?)", [["a".repeat(50), "b".repeat(50)]])).toBeGreaterThanOrEqual(6 + 104);
    expect(statementBytes("?", [10n ** 40n])).toBeGreaterThanOrEqual(41);
    expect(statementBytes("?", [{ toSqlString: () => "y".repeat(100) }])).toBeGreaterThanOrEqual(100);
    // The options form carries its values with it.
    expect(statementBytes({ sql: "SELECT ?", values: ["z".repeat(5000)] })).toBeGreaterThanOrEqual(5008);
  });
});

describe("budgets from the server's max_allowed_packet", () => {
  it("batches a quarter of it, at most 4 MiB", () => {
    expect(insertBudget(16 * 1024 * 1024)).toBe(4 * 1024 * 1024);
    expect(insertBudget(4 * 1024 * 1024)).toBe(1024 * 1024);
  });
  it("lets a Markdown file be stored twice, escaped, in one row", () => {
    expect(markdownFileCeiling(16 * 1024 * 1024)).toBeGreaterThan(3.5 * 1024 * 1024);
    expect(markdownFileCeiling(4 * 1024 * 1024)).toBeLessThan(1024 * 1024);
    expect(markdownFileCeiling(undefined)).toBe(Number.POSITIVE_INFINITY);
  });
});

function fakePool(limitRow: unknown) {
  const sent: string[] = [];
  const query = vi.fn(async (sql: string) => { sent.push(sql); return sql.includes("@@max_allowed_packet") ? [limitRow] : []; });
  const connection = { query: vi.fn(async (sql: string) => { sent.push(`conn:${sql}`); return sql.includes("@@max_allowed_packet") ? [limitRow] : []; }) };
  const pool = { query, getConnection: vi.fn(async () => ({ ...connection })) } as unknown as Pool;
  return { pool, sent };
}

describe("the guard", () => {
  it("reads the limit through the connection that writes, and refuses before sending", async () => {
    const { pool, sent } = fakePool({ limit: 4096 });
    guardPool(pool);
    const connection = await pool.getConnection();
    // The shared domain error itself: a write that reaches the pool directly is answered alike.
    await expect(connection.query("INSERT ?", ["x".repeat(5000)])).rejects.toBeInstanceOf(ContentTooLargeError);
    expect(sent).toEqual(["conn:SELECT @@max_allowed_packet AS `limit`"]);
    expect(knownPacketLimit()).toBe(4096);
    await connection.query("SELECT 1");
    await pool.query("SELECT 2");
    expect(sent).toEqual(["conn:SELECT @@max_allowed_packet AS `limit`", "conn:SELECT 1", "SELECT 2"]);
  });
  it("takes a value it cannot read as a size to be MariaDB's default, never as no limit", async () => {
    const { pool } = fakePool({ limit: null });
    guardPool(pool);
    await pool.query("SELECT 1");
    expect(knownPacketLimit()).toBe(16 * 1024 * 1024);
    await expect(pool.query("INSERT ?", ["x".repeat(17 * 1024 * 1024)])).rejects.toBeInstanceOf(PacketTooLargeError);
  });
});

describe("a statement too large for the server", () => {
  it("is a reason the writer can act on, and never a retryable 5xx", () => {
    for (const error of [new PacketTooLargeError(5_000_000, 4 * 1024 * 1024), Object.assign(new Error("x"), { errno: 1153 })]) {
      expect(mapDatabaseError(error)).toBeInstanceOf(ContentTooLargeError);
    }
    const mapped = mapDatabaseError(new PacketTooLargeError(5_000_000, 4 * 1024 * 1024));
    expect(mapped.message).toContain("larger than the database accepts at once");
    expect(mapped.message).not.toContain("max_allowed_packet");
    expect(toWorkspaceErrorResponse(mapped)).toMatchObject({ status: 413, body: { error: { code: "CONTENT_TOO_LARGE" } } });
    // The import form reads 413 as the platform's request-size cap, so imports answer 400.
    expect(toImportErrorResponse(mapped)).toMatchObject({ status: 400, body: { error: { code: "CONTENT_TOO_LARGE" } } });
  });
});

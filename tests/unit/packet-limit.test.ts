import { describe, expect, it } from "vitest";
import { insertBudget, markdownFileCeiling, statementBytes } from "@/infrastructure/database/mariadb/packet-limit";
import { mapDatabaseError } from "@/infrastructure/database/mariadb/repositories/shared";
import { PacketTooLargeError } from "@/infrastructure/database/mariadb/packet-limit";

describe("statement size", () => {
  it("counts each character the driver escapes as two bytes, and UTF-8 as sent", () => {
    expect(statementBytes("SELECT ?", ["abc"])).toBe(8 + 3 + 2 + 2);
    expect(statementBytes("SELECT ?", ["\n\n'"])).toBe(8 + 6 + 2 + 2);
    expect(statementBytes("SELECT ?", ["長"])).toBe(8 + 3 + 2 + 2);
    expect(statementBytes({ sql: "SELECT 1" })).toBe(8);
  });
  it("is never below what the driver writes for a newline-heavy body", () => {
    const body = "line\n".repeat(10_000);
    const sent = `INSERT INTO t VALUES ('${body.replace(/\n/g, "\\n")}')`;
    expect(statementBytes("INSERT INTO t VALUES (?)", [body])).toBeGreaterThanOrEqual(Buffer.byteLength(sent));
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

describe("a statement too large for the server", () => {
  it("is reported as a limit the writer can act on, not as a retryable failure", () => {
    for (const error of [new PacketTooLargeError(5_000_000, 4 * 1024 * 1024), Object.assign(new Error("x"), { errno: 1153 })]) {
      expect(mapDatabaseError(error)).toMatchObject({ code: "IMPORT_LIMIT_EXCEEDED" });
    }
    expect(mapDatabaseError(new PacketTooLargeError(5_000_000, 4 * 1024 * 1024)).message).toContain("4 MiB per write");
  });
});

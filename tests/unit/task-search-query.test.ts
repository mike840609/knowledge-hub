import { describe, expect, it } from "vitest";
import {
  buildTaskSearchLikePattern,
  parseTaskSearchQuery,
} from "@/modules/task-knowledge/domain/task-search-query";
import {
  decodeTaskSearchCursor,
  encodeTaskSearchCursor,
  taskSearchCriteriaDigest,
} from "@/modules/task-knowledge/domain/task-search-cursor";

const TASK_ID = "019a1e18-7a00-7000-8000-0a0000000001";
const WORKSPACE_ID = "019a1e18-7a00-7000-8000-0a0000000002";

describe("task search query contract", () => {
  it("normalizes mixed CJK/English, whitespace and repeated case-insensitive terms", () => {
    const query = parseTaskSearchQuery({ q: "  登入\u3000  REDIRECT\nredirect\t 進站  " });
    expect(query.q).toBe("登入 REDIRECT redirect 進站");
    expect(query.terms).toEqual(["登入", "redirect", "進站"]);
    expect(query.agent).toBeNull();
    expect(query.verification).toBeNull();
    expect(query.lifecycle).toBe("ACTIVE");
  });

  it("permits filter-only queries and all supported enums", () => {
    expect(parseTaskSearchQuery({ q: " ", agent: "opencode", verification: "not_applicable", archived: "1" })).toMatchObject({
      terms: [], agent: "opencode", verification: "not_applicable", lifecycle: "ARCHIVED",
    });
    for (const status of ["passed", "failed", "not_run", "not_applicable"]) {
      expect(parseTaskSearchQuery({ verification: status }).verification).toBe(status);
    }
  });

  it("rejects unknown agent, verification, lifecycle and oversized queries", () => {
    for (const value of [
      { agent: "other" }, { verification: "excellent" }, { archived: "true" },
      { q: "x".repeat(201) }, { q: "x".repeat(65) }, { q: "a b c d e f" },
    ]) {
      expect(() => parseTaskSearchQuery(value)).toThrow();
    }
    expect(() => parseTaskSearchQuery({ q: "a b c d e e" })).not.toThrow();
  });

  it("escapes LIKE punctuation as literals with explicit escape character", () => {
    expect(buildTaskSearchLikePattern("100%_!")).toBe("%100!%!_!!%");
    expect(buildTaskSearchLikePattern("安全")).toBe("%安全%");
  });

  it("applies an inclusive date range with a fixed UTC offset and an exclusive end", () => {
    const query = parseTaskSearchQuery({ from: "2026-11-01", to: "2026-11-06", offset: "480" });
    expect(query.fromEpochMs).toBe(Date.parse("2026-10-31T16:00:00.000Z"));
    expect(query.beforeEpochMs).toBe(Date.parse("2026-11-06T16:00:00.000Z"));
    expect(query.offsetMinutes).toBe(480);
    expect(parseTaskSearchQuery({ from: "2026-11-01" }).offsetMinutes).toBe(0);
    expect(parseTaskSearchQuery({ to: "2026-11-01", offset: "-480" }).beforeEpochMs).toBe(Date.parse("2026-11-02T08:00:00.000Z"));
  });

  it("supports UTC boundaries beyond SQL DATETIME, leap days and fixed-offset DST intervals", () => {
    expect(parseTaskSearchQuery({ from: "0001-01-01", to: "0001-01-01" }).fromEpochMs).toBe(Date.parse("0001-01-01T00:00:00Z"));
    expect(parseTaskSearchQuery({ from: "9999-12-31", to: "9999-12-31" }).beforeEpochMs).toBe(Date.parse("+010000-01-01T00:00:00.000Z"));
    expect(parseTaskSearchQuery({ from: "2024-02-29", to: "2024-03-02", offset: "-300" }).beforeEpochMs).toBe(Date.parse("2024-03-03T05:00:00.000Z"));
  });

  it("rejects impossible dates, reversed bounds and invalid offsets", () => {
    for (const value of [
      { from: "2026-02-29" }, { from: "2026-04-31" }, { to: "2026-11-31" },
      { from: "2026-12-01", to: "2026-01-01" },
      { from: "not-a-date" }, { offset: "841" }, { offset: "-841" }, { offset: "1.5" },
    ]) expect(() => parseTaskSearchQuery(value)).toThrow();
  });
});

describe("task search cursor contract", () => {
  const query = parseTaskSearchQuery({ q: "安全 login", verification: "passed", from: "2026-11-01", offset: "480" });
  const criteria = taskSearchCriteriaDigest(query, WORKSPACE_ID);

  it("round-trips timestamp and UUIDv7 with canonical criteria", () => {
    const serialized = encodeTaskSearchCursor({ completedAtEpochMs: 1793955000000, taskResultId: TASK_ID }, criteria);
    expect(serialized).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeTaskSearchCursor(serialized, criteria)).toEqual({
      cursor: { completedAtEpochMs: 1793955000000, taskResultId: TASK_ID }, reset: false,
    });
  });

  it("binds cursor to canonical query filters and the workspace", () => {
    expect(taskSearchCriteriaDigest(parseTaskSearchQuery({ q: " 安全   LOGIN ", from: "2026-11-01", offset: "480", verification: "passed" }), WORKSPACE_ID)).toBe(criteria);
    const token = encodeTaskSearchCursor({ completedAtEpochMs: 1793955000000, taskResultId: TASK_ID }, criteria);
    expect(decodeTaskSearchCursor(token, taskSearchCriteriaDigest(query, "019a1e18-7a00-7000-8000-0a0000000003"))).toEqual({ cursor: null, reset: true });
    expect(decodeTaskSearchCursor(token, taskSearchCriteriaDigest(parseTaskSearchQuery({ q: "安全 login", verification: "failed", from: "2026-11-01", offset: "480" }), WORKSPACE_ID))).toEqual({ cursor: null, reset: true });
  });

  it("rejects out-of-domain cursor timestamps while preserving Artifact V1 boundary instants", () => {
    const beyondSqlDate = Date.parse("9999-12-31T23:59:59.999-23:59");
    const valid = encodeTaskSearchCursor({ completedAtEpochMs: beyondSqlDate, taskResultId: TASK_ID }, criteria);
    expect(decodeTaskSearchCursor(valid, criteria)).toEqual({
      cursor: { completedAtEpochMs: beyondSqlDate, taskResultId: TASK_ID }, reset: false,
    });
    for (const timestamp of [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]) {
      const forged = encodeTaskSearchCursor({ completedAtEpochMs: timestamp, taskResultId: TASK_ID }, criteria);
      expect(decodeTaskSearchCursor(forged, criteria)).toEqual({ cursor: null, reset: true });
    }
  });

  it("handles malformed, legacy and incompatible versions by requesting first page", () => {
    expect(decodeTaskSearchCursor(null, criteria)).toEqual({ cursor: null, reset: false });
    expect(decodeTaskSearchCursor("", criteria)).toEqual({ cursor: null, reset: true });
    for (const candidate of [
      TASK_ID, "!!!", "x".repeat(3000), "e30",
      Buffer.from(JSON.stringify({ v: 2, t: 1000, id: TASK_ID, criteria })).toString("base64url"),
      Buffer.from(JSON.stringify({ v: 1, t: 1.5, id: TASK_ID, criteria })).toString("base64url"),
    ]) expect(decodeTaskSearchCursor(candidate, criteria)).toEqual({ cursor: null, reset: true });
  });
});


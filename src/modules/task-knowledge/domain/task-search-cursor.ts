import { createHash } from "node:crypto";
import type { TaskSearchQuery } from "./task-search-query";

export type TaskSearchCursor = { completedAtEpochMs: number; taskResultId: string };
export type TaskSearchCursorResult = { cursor: TaskSearchCursor | null; reset: boolean };

const TASK_ID_UUIDV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
// Artifact V1 permits years 0000..9999 with an explicit offset up to ±23:59.
// Reject forged cursor timestamps outside this representable source range.
const EARLIEST_COMPLETED_AT_MS = Date.parse("0000-01-01T00:00:00.000+23:59");
const LATEST_COMPLETED_AT_MS = Date.parse("9999-12-31T23:59:59.999-23:59");

/** Criteria fingerprint prevents a cursor from being reused across another workspace/filter set. */
export function taskSearchCriteriaDigest(query: TaskSearchQuery, workspaceId: string): string {
  return createHash("sha256").update(JSON.stringify({
    workspaceId,
    q: query.terms,
    agent: query.agent,
    verification: query.verification,
    from: query.from,
    to: query.to,
    offset: query.offsetMinutes,
    lifecycle: query.lifecycle,
  })).digest("base64url");
}

/** Opaque and versioned, but not a permission/authentication token. */
export function encodeTaskSearchCursor(cursor: TaskSearchCursor, criteria: string): string {
  return Buffer.from(JSON.stringify({
    v: 1,
    t: cursor.completedAtEpochMs,
    id: cursor.taskResultId,
    criteria,
  }), "utf8").toString("base64url");
}

/** Any malformed, mismatched or legacy cursor resets to the first page. */
export function decodeTaskSearchCursor(raw: string | null | undefined, criteria: string): TaskSearchCursorResult {
  if (raw === null || raw === undefined) return { cursor: null, reset: false };
  if (raw === "") return { cursor: null, reset: true };
  if (raw.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(raw)) {
    return { cursor: null, reset: true };
  }
  try {
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    if (Buffer.from(decoded, "utf8").toString("base64url") !== raw) {
      return { cursor: null, reset: true };
    }
    const input: unknown = JSON.parse(decoded);
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      return { cursor: null, reset: true };
    }
    const data = input as Record<string, unknown>;
    if (data.v !== 1 || data.criteria !== criteria ||
        typeof data.t !== "number" || !Number.isSafeInteger(data.t) ||
        data.t < EARLIEST_COMPLETED_AT_MS || data.t > LATEST_COMPLETED_AT_MS ||
        typeof data.id !== "string" || !TASK_ID_UUIDV7.test(data.id)) {
      return { cursor: null, reset: true };
    }
    return { cursor: { completedAtEpochMs: data.t, taskResultId: data.id }, reset: false };
  } catch {
    return { cursor: null, reset: true };
  }
}


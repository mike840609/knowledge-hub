import { DomainError } from "@/shared/domain/errors";

const AGENTS = ["claude-code", "opencode"] as const;
const VERIFICATION = ["passed", "failed", "not_run", "not_applicable"] as const;
export type TaskSearchAgent = (typeof AGENTS)[number];
export type TaskSearchVerification = (typeof VERIFICATION)[number];
export type TaskSearchLifecycle = "ACTIVE" | "ARCHIVED";

export type TaskSearchQueryInput = {
  q?: string | null;
  agent?: string | null;
  verification?: string | null;
  from?: string | null;
  to?: string | null;
  offset?: string | null;
  archived?: string | null;
};

export type TaskSearchQuery = {
  q: string;
  terms: string[];
  agent: TaskSearchAgent | null;
  verification: TaskSearchVerification | null;
  from: string | null;
  to: string | null;
  offsetMinutes: number;
  fromEpochMs: number | null;
  beforeEpochMs: number | null;
  lifecycle: TaskSearchLifecycle;
};

function reject(message: string): never {
  throw new DomainError("INVALID_TASK_SEARCH", message);
}

function option<T extends string>(raw: string | null | undefined, values: readonly T[], label: string): T | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (values.includes(raw as T)) return raw as T;
  return reject("Invalid task search " + label + ".");
}

/** The date must round-trip; Date.UTC(y, ...) wrongly interprets years 0-99 as 1900-1999. */
function dateStart(value: string | null | undefined): number | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return reject("Use task search dates in YYYY-MM-DD format.");
  const date = new Date(value + "T00:00:00.000Z");
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    return reject("Invalid task search calendar date.");
  }
  return date.getTime();
}

/** Escaping is literal: the SQL must use LIKE ? ESCAPE '!'. */
export function buildTaskSearchLikePattern(term: string): string {
  return "%" + term.replace(/[!%_]/g, "!$&") + "%";
}

export function parseTaskSearchQuery(input: TaskSearchQueryInput): TaskSearchQuery {
  const raw = input.q ?? "";
  if (raw.length > 200) return reject("Task search query must be at most 200 characters.");
  const q = raw.trim().replace(/\s+/gu, " ");
  const words = q ? q.split(" ") : [];
  const terms = Array.from(new Set(words.map((word) => word.toLowerCase())));
  if (terms.length > 5) return reject("Use at most five task search terms.");
  if (words.some((word) => word.length > 64)) return reject("Each task search term must be at most 64 characters.");
  const agent = option(input.agent, AGENTS, "agent");
  const verification = option(input.verification, VERIFICATION, "verification");
  const lifecycle: TaskSearchLifecycle = input.archived === "1" ? "ARCHIVED" : "ACTIVE";
  if (input.archived && input.archived !== "1") return reject("Invalid archived task search filter.");
  const rawOffset = input.offset || "0";
  if (!/^-?\d+$/.test(rawOffset)) return reject("Invalid task search UTC offset.");
  const offsetMinutes = Number(rawOffset);
  if (!Number.isSafeInteger(offsetMinutes) || Math.abs(offsetMinutes) > 840) {
    return reject("Invalid task search UTC offset.");
  }
  const from = input.from || null;
  const to = input.to || null;
  const fromStart = dateStart(from);
  const toStart = dateStart(to);
  if (fromStart !== null && toStart !== null && fromStart > toStart) {
    return reject("From date must be on or before To date.");
  }
  const offsetMs = offsetMinutes * 60_000;
  return {
    q,
    terms,
    agent,
    verification,
    from,
    to,
    offsetMinutes,
    fromEpochMs: fromStart === null ? null : fromStart - offsetMs,
    beforeEpochMs: toStart === null ? null : toStart + 86_400_000 - offsetMs,
    lifecycle,
  };
}


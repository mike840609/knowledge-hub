import { createHash } from "node:crypto";
import { TaskArtifactError } from "./task-errors";
import { parseTaskReference, type TaskReferenceInput } from "./task-references";

export const MAX_ARTIFACT_BYTES = 64 * 1024;
export const MAX_REFERENCES = 32;
export const MAX_TITLE_LENGTH = 200;
export const MAX_SUMMARY_LENGTH = 20_000;
export const MAX_LIST_ITEMS = 50;
export const MAX_LIST_ITEM_LENGTH = 4000;

export const TASK_AGENTS = ["claude-code", "opencode"] as const;
export const VERIFICATION_STATUSES = ["passed", "failed", "not_run", "not_applicable"] as const;

export type TaskVerification = {
  status: (typeof VERIFICATION_STATUSES)[number];
  checks?: string[];
};

export type TaskContentV1 = {
  agent: (typeof TASK_AGENTS)[number];
  status: "completed";
  title: string;
  summary: string;
  completedAt: string;
  verification: TaskVerification;
  findings?: string[];
  decisions?: string[];
  changes?: string[];
  references?: TaskReferenceInput[];
};

export type TaskArtifactV1 = TaskContentV1 & { schemaVersion: 1; taskId: string; artifactRevision: number };

const CONTENT_KEYS = [
  "agent",
  "status",
  "title",
  "summary",
  "completedAt",
  "verification",
  "findings",
  "decisions",
  "changes",
  "references",
] as const;
const CLI_KEYS = ["schemaVersion", "taskId", "artifactRevision"] as const;
const LIST_KEYS = ["findings", "decisions", "changes"] as const;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ISO_INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;

const invalid = (field: string, reason: string) => new TaskArtifactError("INVALID_ARTIFACT", `${field}: ${reason}`);

function asRecord(raw: unknown, field: string): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw invalid(field, "must be an object");
  return raw as Record<string, unknown>;
}

function boundedString(raw: unknown, field: string, max: number): string {
  if (typeof raw !== "string") throw invalid(field, "must be a string");
  if (raw.trim().length === 0) throw invalid(field, "must not be empty");
  if (raw.length > max) throw invalid(field, `longer than ${max} characters`);
  return raw;
}

function stringList(raw: unknown, field: string): string[] {
  if (!Array.isArray(raw)) throw invalid(field, "must be an array");
  if (raw.length > MAX_LIST_ITEMS) throw invalid(field, `more than ${MAX_LIST_ITEMS} items`);
  return raw.map((item, index) => boundedString(item, `${field}[${index}]`, MAX_LIST_ITEM_LENGTH));
}

function oneOf<T extends string>(raw: unknown, allowed: readonly T[], field: string): T {
  if (typeof raw !== "string" || !allowed.includes(raw as T)) throw invalid(field, `must be one of ${allowed.join(", ")}`);
  return raw as T;
}

function completedAt(raw: unknown): string {
  const field = "completedAt";
  const match = typeof raw === "string" ? ISO_INSTANT.exec(raw) : null;
  if (!match) throw invalid(field, "must be an ISO 8601 date-time with a time zone");
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const real = date.getUTCMonth() === month - 1 && date.getUTCDate() === day && hour < 24 && minute < 60 && second < 60;
  if (!real) throw invalid(field, "is not a real date-time");
  return raw as string;
}

function verification(raw: unknown): TaskVerification {
  const record = asRecord(raw, "verification");
  for (const key of Object.keys(record)) {
    if (key !== "status" && key !== "checks") throw invalid(`verification.${key}`, "unknown field");
  }
  const status = oneOf(record.status, VERIFICATION_STATUSES, "verification.status");
  if (!("checks" in record)) return { status };
  return { status, checks: stringList(record.checks, "verification.checks") };
}

function references(raw: unknown): TaskReferenceInput[] {
  if (!Array.isArray(raw)) throw invalid("references", "must be an array");
  if (raw.length > MAX_REFERENCES) throw invalid("references", `more than ${MAX_REFERENCES} references`);
  return raw.map((item, index) => parseTaskReference(item, index));
}

function contentFrom(record: Record<string, unknown>): TaskContentV1 {
  const content: TaskContentV1 = {
    agent: oneOf(record.agent, TASK_AGENTS, "agent"),
    status: oneOf(record.status, ["completed"] as const, "status"),
    title: boundedString(record.title, "title", MAX_TITLE_LENGTH),
    summary: boundedString(record.summary, "summary", MAX_SUMMARY_LENGTH),
    completedAt: completedAt(record.completedAt),
    verification: verification(record.verification),
  };
  for (const key of LIST_KEYS) if (key in record) content[key] = stringList(record[key], key);
  if ("references" in record) content.references = references(record.references);
  return content;
}

function assertOnly(record: Record<string, unknown>, allowed: readonly string[]) {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) throw invalid(key, "unknown field");
  }
}

/** The Agent-authored part: CLI-owned and binding fields are refused, never stripped. */
export function parseTaskContent(raw: unknown): TaskContentV1 {
  const record = asRecord(raw, "content");
  for (const key of [...CLI_KEYS, "bindingId"]) {
    if (key in record) throw invalid(key, "is set by the CLI or the server, not by the Agent");
  }
  assertOnly(record, CONTENT_KEYS);
  return contentFrom(record);
}

export function parseTaskArtifact(raw: unknown): TaskArtifactV1 {
  const record = asRecord(raw, "artifact");
  if (typeof record.schemaVersion === "number" && record.schemaVersion !== 1) {
    throw new TaskArtifactError("UNSUPPORTED_SCHEMA_VERSION", "schemaVersion: only 1 is supported");
  }
  if (record.schemaVersion !== 1) throw invalid("schemaVersion", "must be 1");
  if (typeof record.taskId !== "string" || !UUID_V4.test(record.taskId)) throw invalid("taskId", "must be a lowercase UUIDv4");
  const revision = record.artifactRevision;
  if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 1) {
    throw invalid("artifactRevision", "must be a positive integer");
  }
  assertOnly(record, [...CLI_KEYS, ...CONTENT_KEYS]);
  return { schemaVersion: 1, taskId: record.taskId, artifactRevision: revision, ...contentFrom(record) };
}

/** Size is measured on the bytes actually read, before any parse. */
export function decodeTaskArtifactBody(bytes: Uint8Array): unknown {
  if (bytes.byteLength > MAX_ARTIFACT_BYTES) {
    throw new TaskArtifactError("PAYLOAD_TOO_LARGE", `body is larger than ${MAX_ARTIFACT_BYTES} bytes`);
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new TaskArtifactError("MALFORMED_JSON", "body is not valid UTF-8 JSON");
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Sorted-key JSON: what is stored, and what the content hash covers. */
export function canonicalTaskJson(artifact: TaskArtifactV1): string {
  return canonical(artifact);
}

export function canonicalTaskHash(artifact: TaskArtifactV1): string {
  return createHash("sha256").update(canonical(artifact)).digest("hex");
}

// The CLI's own copy of the Task Artifact v1 contract. It must accept and
// reject exactly what src/modules/task-knowledge/domain/task-artifact.ts does;
// the shared fixtures in tests/fixtures/task-artifact hold the two together.

export const MAX_ARTIFACT_BYTES = 64 * 1024;
const MAX_REFERENCES = 32;
const MAX_TITLE_LENGTH = 200;
const MAX_SUMMARY_LENGTH = 20_000;
const MAX_LIST_ITEMS = 50;
const MAX_LIST_ITEM_LENGTH = 4000;
const MAX_REFERENCE_PATH_LENGTH = 1024;
const MAX_PR_URL_LENGTH = 2048;
const AGENTS = ["claude-code", "opencode"];
const VERIFICATION = ["passed", "failed", "not_run", "not_applicable"];
const CONTENT_KEYS = ["agent", "status", "title", "summary", "completedAt", "verification", "findings", "decisions", "changes", "references"];
const CLI_KEYS = ["schemaVersion", "taskId", "artifactRevision"];
const LIST_KEYS = ["findings", "decisions", "changes"];
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ANY_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?(Z|[+-](\d{2}):(\d{2}))$/;
const COMMIT_ID = /^[0-9A-Za-z._-]{1,128}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;

/** Names the field, never its value: content may carry something it should not. */
export class ContractError extends Error {
  constructor(field, reason) {
    super(`${field}: ${reason}`);
    this.name = "ContractError";
  }
}

const isRecord = (raw) => typeof raw === "object" && raw !== null && !Array.isArray(raw);

function record(raw, field) {
  if (!isRecord(raw)) throw new ContractError(field, "must be an object");
  return raw;
}

function boundedString(raw, field, max) {
  if (typeof raw !== "string") throw new ContractError(field, "must be a string");
  if (raw.trim().length === 0) throw new ContractError(field, "must not be empty");
  if (raw.length > max) throw new ContractError(field, `longer than ${max} characters`);
}

function stringList(raw, field) {
  if (!Array.isArray(raw)) throw new ContractError(field, "must be an array");
  if (raw.length > MAX_LIST_ITEMS) throw new ContractError(field, `more than ${MAX_LIST_ITEMS} items`);
  raw.forEach((item, index) => boundedString(item, `${field}[${index}]`, MAX_LIST_ITEM_LENGTH));
}

function oneOf(raw, allowed, field) {
  if (typeof raw !== "string" || !allowed.includes(raw)) throw new ContractError(field, `must be one of ${allowed.join(", ")}`);
}

function completedAt(raw) {
  const match = typeof raw === "string" ? ISO_INSTANT.exec(raw) : null;
  if (!match) throw new ContractError("completedAt", "must be an ISO 8601 date-time with a time zone");
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const [offsetHour, offsetMinute] = [Number(match[9] ?? 0), Number(match[10] ?? 0)];
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day || hour >= 24 || minute >= 60 || second >= 60
    || offsetHour >= 24 || offsetMinute >= 60) {
    throw new ContractError("completedAt", "is not a real date-time");
  }
}

function relativePath(value, field) {
  if (value.length === 0 || value.length > MAX_REFERENCE_PATH_LENGTH) throw new ContractError(field, "length out of bounds");
  if (CONTROL.test(value)) throw new ContractError(field, "control characters are not allowed");
  if (value.startsWith("/") || value.startsWith("\\")) throw new ContractError(field, "must be relative");
  if (/^[A-Za-z]:/.test(value)) throw new ContractError(field, "drive letters are not allowed");
  if (value.split(/[\\/]/).includes("..")) throw new ContractError(field, "'..' segments are not allowed");
}

function prUrl(value, field) {
  if (value.length > MAX_PR_URL_LENGTH) throw new ContractError(field, "too long");
  if (CONTROL.test(value) || /\s/.test(value)) throw new ContractError(field, "whitespace or control characters are not allowed");
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new ContractError(field, "not a URL");
  }
  if (url.protocol !== "https:") throw new ContractError(field, "only https: is allowed");
  if (url.username || url.password) throw new ContractError(field, "userinfo is not allowed");
}

function onlyKeys(raw, allowed, field) {
  for (const key of Object.keys(raw)) if (!allowed.includes(key)) throw new ContractError(`${field}.${key}`, "unknown field");
}

function stringAt(raw, key, field) {
  if (typeof raw[key] !== "string") throw new ContractError(`${field}.${key}`, "must be a string");
  return raw[key];
}

function reference(raw, index) {
  const field = `references[${index}]`;
  if (!isRecord(raw)) throw new ContractError(field, "must be an object");
  if (raw.type === "WIKI") {
    const hasPath = "path" in raw;
    if (hasPath === "documentId" in raw) throw new ContractError(field, "WIKI needs exactly one of path or documentId");
    if (hasPath) {
      onlyKeys(raw, ["type", "path"], field);
      return relativePath(stringAt(raw, "path", field), `${field}.path`);
    }
    onlyKeys(raw, ["type", "documentId"], field);
    if (!ANY_UUID.test(stringAt(raw, "documentId", field))) throw new ContractError(`${field}.documentId`, "must be a document ID");
    return;
  }
  const KEYS = { CODE_FILE: ["type", "path"], COMMIT: ["type", "id"], PR_URL: ["type", "url"] };
  const keys = typeof raw.type === "string" && Object.hasOwn(KEYS, raw.type) ? KEYS[raw.type] : undefined;
  if (!keys) throw new ContractError(`${field}.type`, "unknown reference type");
  onlyKeys(raw, keys, field);
  if (raw.type === "CODE_FILE") return relativePath(stringAt(raw, "path", field), `${field}.path`);
  if (raw.type === "COMMIT") {
    if (!COMMIT_ID.test(stringAt(raw, "id", field))) throw new ContractError(`${field}.id`, "must be 1-128 characters of [0-9A-Za-z._-]");
    return;
  }
  prUrl(stringAt(raw, "url", field), `${field}.url`);
}

function contentFields(raw) {
  oneOf(raw.agent, AGENTS, "agent");
  oneOf(raw.status, ["completed"], "status");
  boundedString(raw.title, "title", MAX_TITLE_LENGTH);
  boundedString(raw.summary, "summary", MAX_SUMMARY_LENGTH);
  completedAt(raw.completedAt);
  const verification = record(raw.verification, "verification");
  for (const key of Object.keys(verification)) {
    if (key !== "status" && key !== "checks") throw new ContractError(`verification.${key}`, "unknown field");
  }
  oneOf(verification.status, VERIFICATION, "verification.status");
  if ("checks" in verification) stringList(verification.checks, "verification.checks");
  for (const key of LIST_KEYS) if (key in raw) stringList(raw[key], key);
  if ("references" in raw) {
    if (!Array.isArray(raw.references)) throw new ContractError("references", "must be an array");
    if (raw.references.length > MAX_REFERENCES) throw new ContractError("references", `more than ${MAX_REFERENCES} references`);
    raw.references.forEach(reference);
  }
}

/** The Agent-authored part: CLI-owned and binding fields are refused, never stripped. */
export function validateContent(raw) {
  const value = record(raw, "content");
  for (const key of [...CLI_KEYS, "bindingId"]) {
    if (key in value) throw new ContractError(key, "is set by the CLI or the server, not by the Agent");
  }
  for (const key of Object.keys(value)) if (!CONTENT_KEYS.includes(key)) throw new ContractError(key, "unknown field");
  contentFields(value);
  return value;
}

export function validateArtifact(raw) {
  const value = record(raw, "artifact");
  if (value.schemaVersion !== 1) throw new ContractError("schemaVersion", "must be 1");
  if (typeof value.taskId !== "string" || !UUID_V4.test(value.taskId)) throw new ContractError("taskId", "must be a lowercase UUIDv4");
  if (!Number.isSafeInteger(value.artifactRevision) || value.artifactRevision < 1) throw new ContractError("artifactRevision", "must be a positive integer");
  for (const key of Object.keys(value)) if (![...CLI_KEYS, ...CONTENT_KEYS].includes(key)) throw new ContractError(key, "unknown field");
  contentFields(value);
  return value;
}

import { isUuid } from "@/shared/ids/uuid";
import { TaskArtifactError } from "./task-errors";

export type TaskReferenceInput =
  | { type: "WIKI"; path: string }
  | { type: "WIKI"; documentId: string }
  | { type: "CODE_FILE"; path: string }
  | { type: "COMMIT"; id: string }
  | { type: "PR_URL"; url: string };

export const MAX_REFERENCE_PATH_LENGTH = 1024;
export const MAX_PR_URL_LENGTH = 2048;
const COMMIT_ID = /^[0-9A-Za-z._-]{1,128}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;

function invalid(field: string, reason: string): TaskArtifactError {
  return new TaskArtifactError("INVALID_ARTIFACT", `${field}: ${reason}`);
}

/**
 * Lexical rules shared by WIKI and CODE_FILE paths. The input is returned
 * unchanged: normalization that must match Folder Sync happens in the adapter.
 */
function validateRelativePath(value: string, field: string): string {
  if (value.length === 0 || value.length > MAX_REFERENCE_PATH_LENGTH) throw invalid(field, "length out of bounds");
  if (CONTROL.test(value)) throw invalid(field, "control characters are not allowed");
  if (value.startsWith("/") || value.startsWith("\\")) throw invalid(field, "must be relative");
  if (/^[A-Za-z]:/.test(value)) throw invalid(field, "drive letters are not allowed");
  if (value.split(/[\\/]/).includes("..")) throw invalid(field, "'..' segments are not allowed");
  return value;
}

export const validateWikiReferencePath = (value: string, field = "path") => validateRelativePath(value, field);
export const validateCodeFilePath = (value: string, field = "path") => validateRelativePath(value, field);

export function validateCommitId(value: string, field = "id"): string {
  if (!COMMIT_ID.test(value)) throw invalid(field, "must be 1-128 characters of [0-9A-Za-z._-]");
  return value;
}

export function validatePrUrl(value: string, field = "url"): string {
  if (value.length > MAX_PR_URL_LENGTH) throw invalid(field, "too long");
  if (CONTROL.test(value) || /\s/.test(value)) throw invalid(field, "whitespace or control characters are not allowed");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalid(field, "not a URL");
  }
  if (url.protocol !== "https:") throw invalid(field, "only https: is allowed");
  if (url.username || url.password) throw invalid(field, "userinfo is not allowed");
  return value;
}

const REFERENCE_KEYS: Record<string, readonly string[]> = {
  CODE_FILE: ["type", "path"],
  COMMIT: ["type", "id"],
  PR_URL: ["type", "url"],
};

function stringField(raw: Record<string, unknown>, key: string, field: string): string {
  const value = raw[key];
  if (typeof value !== "string") throw invalid(`${field}.${key}`, "must be a string");
  return value;
}

function assertKeys(raw: Record<string, unknown>, allowed: readonly string[], field: string) {
  for (const key of Object.keys(raw)) if (!allowed.includes(key)) throw invalid(`${field}.${key}`, "unknown field");
}

export function parseTaskReference(raw: unknown, index: number): TaskReferenceInput {
  const field = `references[${index}]`;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw invalid(field, "must be an object");
  const record = raw as Record<string, unknown>;
  const type = record.type;
  if (type === "WIKI") {
    const hasPath = "path" in record;
    if (hasPath === "documentId" in record) throw invalid(field, "WIKI needs exactly one of path or documentId");
    if (hasPath) {
      assertKeys(record, ["type", "path"], field);
      return { type, path: validateWikiReferencePath(stringField(record, "path", field), `${field}.path`) };
    }
    assertKeys(record, ["type", "documentId"], field);
    const documentId = stringField(record, "documentId", field);
    if (!isUuid(documentId)) throw invalid(`${field}.documentId`, "must be a document ID");
    return { type, documentId };
  }
  if (typeof type !== "string" || !(type in REFERENCE_KEYS)) throw invalid(`${field}.type`, "unknown reference type");
  assertKeys(record, REFERENCE_KEYS[type], field);
  if (type === "CODE_FILE") return { type, path: validateCodeFilePath(stringField(record, "path", field), `${field}.path`) };
  if (type === "COMMIT") return { type, id: validateCommitId(stringField(record, "id", field), `${field}.id`) };
  return { type: "PR_URL", url: validatePrUrl(stringField(record, "url", field), `${field}.url`) };
}

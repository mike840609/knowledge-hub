import { IntegrityError, IntegrityViolationError } from "@/modules/knowledge/domain/errors";
import { importError } from "@/modules/sources/domain/import-errors";
import type { DatabaseConnection } from "../pool";

export type DbRow = Record<string, unknown>;
export type QueryConnection = Pick<DatabaseConnection, "query">;

export function asDate(value: unknown): Date {
  if (value instanceof Date) return value;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new IntegrityError("Database returned an invalid timestamp.");
  return date;
}

export function asNullableDate(value: unknown): Date | null {
  return value === null || typeof value === "undefined" ? null : asDate(value);
}

export function asNumber(value: unknown, field: string): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw new IntegrityError(`Database returned an invalid ${field}.`);
  return result;
}

export function asRequiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new IntegrityError(`Database returned an invalid ${field}.`);
  }
  return value;
}

export function asJsonObject(value: unknown, field: string): Record<string, unknown> {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new IntegrityError(`Database returned invalid ${field} JSON.`);
  }
  return parsed as Record<string, unknown>;
}

const INTEGRITY_CODES = ["ER_DUP_ENTRY", "ER_NO_REFERENCED_ROW_2", "ER_ROW_IS_REFERENCED_2", "ER_CHECK_CONSTRAINT_VIOLATED", "ER_NO_REFERENCED_ROW", "ER_CONSTRAINT_FAILED"];
const INTEGRITY_ERRNOS = [1062, 1452, 1451, 3819, 1216, 4025];

/**
 * Design §17.3: deadlock / lock wait timeout is a retryable apply failure, not
 * an internal error — the transaction rolled back, so nothing changed and the
 * same snapshot can be applied again. `mariadb`'s `SqlError` sets both `errno`
 * (1213 / 1205) and the `code` string it derives from `errno`, but `code` falls
 * back to `"UNKNOWN"` when the errno is absent from the driver's table, so both
 * are matched here.
 */
const RETRYABLE_CODES = ["ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"];
const RETRYABLE_ERRNOS = [1213, 1205];

/**
 * Defense-in-depth for source-provided values that slip past validation:
 * an over-long string fails the insert with ER_DATA_TOO_LONG and an
 * out-of-range temporal fails with ER_TRUNCATED_WRONG_VALUE_FOR_FIELD.
 * Both mean the request payload was invalid, so they map to a 400-level
 * import error whose message carries no driver internals.
 */
const DATA_BOUND_CODES = ["ER_DATA_TOO_LONG", "ER_TRUNCATED_WRONG_VALUE_FOR_FIELD"];
const DATA_BOUND_ERRNOS = [1406, 1292];

export function mapDatabaseError(error: unknown): Error {
  const message = error instanceof Error ? error.message : "Database operation failed.";
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  const errno = typeof error === "object" && error !== null && "errno" in error ? Number(error.errno) : Number.NaN;
  if (RETRYABLE_CODES.includes(code) || RETRYABLE_ERRNOS.includes(errno)) {
    return importError("IMPORT_APPLY_RETRYABLE", "A transient database conflict interrupted the operation; retry the request.");
  }
  if (DATA_BOUND_CODES.includes(code) || DATA_BOUND_ERRNOS.includes(errno)) {
    return importError("INVALID_IMPORT_MANIFEST", "Import manifest contains a value that exceeds the database storage limit.");
  }
  if (INTEGRITY_CODES.includes(code) || INTEGRITY_ERRNOS.includes(errno)) {
    return new IntegrityViolationError();
  }
  const wrapped = new Error("Database operation failed.");
  wrapped.cause = { code, message };
  return wrapped;
}

export function affectedRows(result: unknown): number {
  if (typeof result !== "object" || result === null || !("affectedRows" in result)) return 0;
  return Number((result as { affectedRows: number }).affectedRows);
}

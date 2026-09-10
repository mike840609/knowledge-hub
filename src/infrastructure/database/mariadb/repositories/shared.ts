import { IntegrityError } from "@/modules/knowledge/domain/errors";
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

export function mapDatabaseError(error: unknown): Error {
  const message = error instanceof Error ? error.message : "Database operation failed.";
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  if (["ER_DUP_ENTRY", "ER_NO_REFERENCED_ROW_2", "ER_ROW_IS_REFERENCED_2", "ER_CHECK_CONSTRAINT_VIOLATED", "ER_NO_REFERENCED_ROW"].includes(code)) {
    return new IntegrityError("The requested data violates a Knowledge Hub integrity constraint.");
  }
  const wrapped = new Error("Database operation failed.");
  wrapped.cause = { code, message };
  return wrapped;
}

export function affectedRows(result: unknown): number {
  if (typeof result !== "object" || result === null || !("affectedRows" in result)) return 0;
  return Number((result as { affectedRows: number }).affectedRows);
}

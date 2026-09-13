import { describe, expect, it } from "vitest";
import { IntegrityViolationError } from "@/modules/knowledge/domain/errors";
import { SourceImportError } from "@/modules/sources/domain/import-errors";
import { mapDatabaseError } from "@/infrastructure/database/mariadb/repositories/shared";
import { toImportErrorResponse } from "@/server/http-error-response";

/**
 * `mapDatabaseError` is the only boundary that turns a driver error into a
 * domain error, so it is unit-testable with a synthetic error shaped like
 * `mariadb`'s `SqlError` (both `code` and `errno` are set by the driver).
 */
function sqlError(code: string, errno: number): Error {
  return Object.assign(new Error(`(conn:1, no: ${errno}, SQLState: 40001) ${code}`), { code, errno, sqlState: "40001" });
}

describe("mapDatabaseError", () => {
  it("maps integrity constraint codes to IntegrityViolationError", () => {
    for (const [code, errno] of [
      ["ER_DUP_ENTRY", 1062],
      ["ER_NO_REFERENCED_ROW_2", 1452],
      ["ER_ROW_IS_REFERENCED_2", 1451],
      ["ER_CHECK_CONSTRAINT_VIOLATED", 3819],
      ["ER_NO_REFERENCED_ROW", 1216],
    ] as const) {
      const mapped = mapDatabaseError(sqlError(code, errno));
      expect(mapped, code).toBeInstanceOf(IntegrityViolationError);
      expect((mapped as IntegrityViolationError).code).toBe("INTEGRITY_VIOLATION");
    }
  });

  it("maps deadlock and lock wait timeout to IMPORT_APPLY_RETRYABLE by string code", () => {
    for (const [code, errno] of [
      ["ER_LOCK_DEADLOCK", 1213],
      ["ER_LOCK_WAIT_TIMEOUT", 1205],
    ] as const) {
      const mapped = mapDatabaseError(sqlError(code, errno));
      expect(mapped, code).toBeInstanceOf(SourceImportError);
      expect((mapped as SourceImportError).code).toBe("IMPORT_APPLY_RETRYABLE");
      expect(mapped.message).not.toContain("SQLState");
    }
  });

  it("maps deadlock and lock wait timeout by numeric errno when the string code is absent", () => {
    for (const errno of [1213, 1205]) {
      const mapped = mapDatabaseError(Object.assign(new Error("lock failure"), { errno }));
      expect(mapped, String(errno)).toBeInstanceOf(SourceImportError);
      expect((mapped as SourceImportError).code).toBe("IMPORT_APPLY_RETRYABLE");
    }
  });

  it("maps a retryable driver error to a 409 response with the machine-readable code", () => {
    const mapped = toImportErrorResponse(mapDatabaseError(sqlError("ER_LOCK_DEADLOCK", 1213)));
    expect(mapped.status).toBe(409);
    expect(mapped.body.error.code).toBe("IMPORT_APPLY_RETRYABLE");
  });

  it("wraps unknown database errors without leaking the driver message", () => {
    const mapped = mapDatabaseError(sqlError("ER_PARSE_ERROR", 1064));
    expect(mapped).not.toBeInstanceOf(IntegrityViolationError);
    expect(mapped).not.toBeInstanceOf(SourceImportError);
    expect(mapped.message).toBe("Database operation failed.");
    expect(toImportErrorResponse(mapped).status).toBe(500);
  });

  it("tolerates non-error inputs", () => {
    const mapped = mapDatabaseError("boom");
    expect(mapped.message).toBe("Database operation failed.");
    expect(mapped).not.toBeInstanceOf(SourceImportError);
  });
});

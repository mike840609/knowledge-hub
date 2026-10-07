import { describe, expect, it } from "vitest";
import { IntegrityViolationError } from "@/modules/knowledge/domain/errors";
import { SourceImportError } from "@/modules/sources/domain/import-errors";
import { mapDatabaseError } from "@/infrastructure/database/mariadb/repositories/shared";
import { toImportErrorResponse, toWorkspaceErrorResponse } from "@/server/http-error-response";
import { WorkspaceBusyError } from "@/shared/domain/errors";

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

  it("maps deadlock and lock wait timeout to WORKSPACE_BUSY by string code, for any write", () => {
    for (const [code, errno] of [
      ["ER_LOCK_DEADLOCK", 1213],
      ["ER_LOCK_WAIT_TIMEOUT", 1205],
    ] as const) {
      const mapped = mapDatabaseError(sqlError(code, errno));
      expect(mapped, code).toBeInstanceOf(WorkspaceBusyError);
      expect((mapped as WorkspaceBusyError).code).toBe("WORKSPACE_BUSY");
      // Not an import error: a plain note save meets this too.
      expect(mapped).not.toBeInstanceOf(SourceImportError);
      expect(mapped.message).not.toContain("SQLState");
    }
  });

  it("maps deadlock and lock wait timeout by numeric errno when the string code is absent", () => {
    for (const errno of [1213, 1205]) {
      const mapped = mapDatabaseError(Object.assign(new Error("lock failure"), { errno }));
      expect(mapped, String(errno)).toBeInstanceOf(WorkspaceBusyError);
    }
  });

  it("maps data-bound driver errors to 400 INVALID_IMPORT_MANIFEST without leaking driver internals", () => {
    for (const [code, errno] of [
      ["ER_DATA_TOO_LONG", 1406],
      ["ER_TRUNCATED_WRONG_VALUE_FOR_FIELD", 1292],
    ] as const) {
      const mapped = mapDatabaseError(sqlError(code, errno));
      expect(mapped, code).toBeInstanceOf(SourceImportError);
      expect((mapped as SourceImportError).code).toBe("INVALID_IMPORT_MANIFEST");
      expect(mapped.message).not.toContain("SQLState");
      expect(mapped.message).not.toContain(code);
      const response = toImportErrorResponse(mapped);
      expect(response.status, code).toBe(400);
      expect(response.body.error.code).toBe("INVALID_IMPORT_MANIFEST");
    }
  });

  it("maps data-bound driver errors by numeric errno when the string code is absent", () => {
    for (const errno of [1406, 1292]) {
      const mapped = mapDatabaseError(Object.assign(new Error("truncation failure"), { errno }));
      expect(mapped, String(errno)).toBeInstanceOf(SourceImportError);
      expect((mapped as SourceImportError).code).toBe("INVALID_IMPORT_MANIFEST");
      expect(toImportErrorResponse(mapped).status).toBe(400);
    }
  });

  it("maps MariaDB ER_CONSTRAINT_FAILED (4025) to IntegrityViolationError", () => {
    const mapped = mapDatabaseError(sqlError("ER_CONSTRAINT_FAILED", 4025));
    expect(mapped).toBeInstanceOf(IntegrityViolationError);
    expect((mapped as IntegrityViolationError).code).toBe("INTEGRITY_VIOLATION");
  });

  it("answers a busy workspace with 503 and its code on both import and workspace routes", () => {
    const busy = mapDatabaseError(sqlError("ER_LOCK_WAIT_TIMEOUT", 1205));
    for (const response of [toImportErrorResponse(busy), toWorkspaceErrorResponse(busy)]) {
      expect(response.status).toBe(503);
      expect(response.body.error.code).toBe("WORKSPACE_BUSY");
      expect(response.body.error.message).toMatch(/try again in a moment/);
    }
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

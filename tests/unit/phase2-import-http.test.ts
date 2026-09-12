import { describe, expect, it } from "vitest";
import { importError } from "@/modules/sources/domain/import-errors";
import { WorkspaceAccessDeniedError, WorkspaceNotFoundError } from "@/modules/workspaces/domain/errors";
import { toImportErrorResponse } from "@/server/http-error-response";

describe("Phase 2 import HTTP error mapping", () => {
  it("maps hidden access/not-found errors to 404 NOT_FOUND", () => {
    for (const error of [
      importError("IMPORT_SNAPSHOT_NOT_FOUND", "Import snapshot was not found."),
      importError("IMPORT_SOURCE_NOT_FOUND", "Import source was not found."),
      new WorkspaceAccessDeniedError(),
      new WorkspaceNotFoundError(),
    ]) {
      const mapped = toImportErrorResponse(error);
      expect(mapped.status).toBe(404);
      expect(mapped.body).toEqual({ error: { code: "NOT_FOUND", message: expect.any(String) } });
    }
  });

  it("maps source version/stale/retryable conflicts to 409", () => {
    for (const code of [
      "SOURCE_VERSION_CONFLICT",
      "IMPORT_SNAPSHOT_STALE",
      "IMPORT_APPLY_RETRYABLE",
      "UPLOAD_ENTRY_CONFLICT",
    ]) {
      const mapped = toImportErrorResponse(importError(code, `${code} happened.`));
      expect(mapped.status).toBe(409);
      expect(mapped.body.error.code).toBe(code);
    }
  });

  it("maps limit/incomplete/invalid errors to 400 and preserves the code", () => {
    for (const code of [
      "IMPORT_LIMIT_EXCEEDED",
      "INVALID_IMPORT_MANIFEST",
      "INVALID_ASSET_MANIFEST",
      "INVALID_UPLOAD_BATCH",
      "UPLOAD_INCOMPLETE",
      "UPLOAD_SIZE_MISMATCH",
      "IMPORT_SNAPSHOT_NOT_READY",
      "IMPORT_SNAPSHOT_BLOCKED",
      "IMPORT_SNAPSHOT_EXPIRED",
      "IMPORT_SNAPSHOT_NOT_BUILDING",
    ]) {
      const mapped = toImportErrorResponse(importError(code, `${code} happened.`));
      expect(mapped.status).toBe(400);
      expect(mapped.body.error.code).toBe(code);
      expect(mapped.body.error.message).toBe(`${code} happened.`);
    }
  });

  it("maps unknown errors to 500 INTERNAL_ERROR without leaking internals", () => {
    const mapped = toImportErrorResponse(new Error("db password=hunter2 exploded"));
    expect(mapped.status).toBe(500);
    expect(mapped.body.error.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(mapped.body)).not.toContain("hunter2");
  });
});

import { describe, expect, it } from "vitest";
import { classifyApplyError } from "@/components/knowledge/source-import-preview-actions";
import { readErrorCode } from "@/components/knowledge/source-import-launcher";

/**
 * Design §20.7: the UI branches on the machine-readable `code`, never on the
 * message and never on the HTTP status alone — four distinct import codes all
 * map to 409, and only two of them mean "this preview is dead".
 */
function envelope(code: string, message = `${code} happened.`): unknown {
  return { error: { code, message } };
}

describe("classifyApplyError", () => {
  it("latches the stale state for the two codes that invalidate the snapshot", () => {
    for (const code of ["SOURCE_VERSION_CONFLICT", "IMPORT_SNAPSHOT_STALE"]) {
      const failure = classifyApplyError(409, envelope(code));
      expect(failure.code, code).toBe(code);
      expect(failure.latchStale, code).toBe(true);
      expect(failure.message, code).toMatch(/folder again/iu);
    }
  });

  it("does not latch a retryable apply failure and explains that a retry is safe", () => {
    const failure = classifyApplyError(409, envelope("IMPORT_APPLY_RETRYABLE"));
    expect(failure.code).toBe("IMPORT_APPLY_RETRYABLE");
    expect(failure.latchStale).toBe(false);
    expect(failure.message).toMatch(/try again/iu);
  });

  it("surfaces any other 409 code without latching", () => {
    const failure = classifyApplyError(409, envelope("UPLOAD_ENTRY_CONFLICT", "Entry already uploaded."));
    expect(failure.code).toBe("UPLOAD_ENTRY_CONFLICT");
    expect(failure.latchStale).toBe(false);
    expect(failure.message).toBe("Entry already uploaded.");
  });

  it("surfaces non-conflict codes verbatim without latching", () => {
    const failure = classifyApplyError(400, envelope("IMPORT_SNAPSHOT_BLOCKED", "Blockers must be fixed."));
    expect(failure.code).toBe("IMPORT_SNAPSHOT_BLOCKED");
    expect(failure.latchStale).toBe(false);
    expect(failure.message).toBe("Blockers must be fixed.");
  });

  it("falls back conservatively on a 409 with no readable envelope", () => {
    for (const body of [null, undefined, "nope", { error: "nope" }, { error: { code: 7 } }]) {
      const failure = classifyApplyError(409, body);
      expect(failure.latchStale, JSON.stringify(body ?? null)).toBe(true);
      expect(failure.code, JSON.stringify(body ?? null)).not.toBe("IMPORT_APPLY_RETRYABLE");
      expect(typeof failure.message).toBe("string");
    }
  });

  it("falls back to a generic apply failure on a non-conflict status with no envelope", () => {
    for (const status of [400, 404, 500]) {
      const failure = classifyApplyError(status, null);
      expect(failure.code, String(status)).toBe("IMPORT_APPLY_FAILED");
      expect(failure.latchStale, String(status)).toBe(false);
    }
  });

  it("uses the server message when a known code carries one and no guidance is needed", () => {
    const failure = classifyApplyError(500, envelope("INTERNAL_ERROR", "An unexpected error occurred."));
    expect(failure.code).toBe("INTERNAL_ERROR");
    expect(failure.message).toBe("An unexpected error occurred.");
  });
});

describe("readErrorCode", () => {
  it("prefers the machine-readable code from the envelope", () => {
    expect(readErrorCode(envelope("IMPORT_APPLY_RETRYABLE"), "fallback")).toEqual({
      code: "IMPORT_APPLY_RETRYABLE",
      message: "IMPORT_APPLY_RETRYABLE happened.",
    });
  });

  it("never invents SOURCE_VERSION_CONFLICT when the envelope carries no code", () => {
    const failure = readErrorCode(null, "Creating the import session failed.");
    expect(failure.code).not.toBe("SOURCE_VERSION_CONFLICT");
    expect(failure.message).toBe("Creating the import session failed.");
  });

  it("falls back to the supplied message when the envelope has no string code", () => {
    for (const body of [null, "nope", { error: "nope" }, { error: { code: 7, message: 9 } }]) {
      expect(readErrorCode(body, "fallback").message).toBe("fallback");
      expect(readErrorCode(body, "fallback").code).toBe("IMPORT_REQUEST_FAILED");
    }
  });

  it("falls back to the supplied message when the envelope code has no message", () => {
    expect(readErrorCode({ error: { code: "INVALID_IMPORT_MANIFEST" } }, "fallback")).toEqual({
      code: "INVALID_IMPORT_MANIFEST",
      message: "fallback",
    });
  });
});

import { describe, expect, it } from "vitest";
import {
  DocumentArchivedError,
  DocumentNotFoundError,
  InvalidTitleError,
  RevisionConflictError,
  SourceArchivedError,
  SourceNotFoundError,
  SourceReadOnlyError,
} from "@/modules/knowledge/domain/errors";
import { toWorkspaceErrorResponse } from "@/server/http-error-response";

describe("Phase 5 authoring error mapping (spec §7.2)", () => {
  it("maps a stale-editor conflict to 409, never 500", () => {
    const mapped = toWorkspaceErrorResponse(new RevisionConflictError());
    expect(mapped.status).toBe(409);
    expect(mapped.body.error.code).toBe("REVISION_CONFLICT");
  });

  it("maps a write against SOURCE_MANAGED content to 409", () => {
    expect(toWorkspaceErrorResponse(new SourceReadOnlyError()).status).toBe(409);
  });

  it("maps archived source and document to 409", () => {
    expect(toWorkspaceErrorResponse(new SourceArchivedError()).status).toBe(409);
    expect(toWorkspaceErrorResponse(new DocumentArchivedError()).status).toBe(409);
  });

  it("maps candidate validation failures to 400", () => {
    const mapped = toWorkspaceErrorResponse(new InvalidTitleError());
    expect(mapped.status).toBe(400);
    expect(mapped.body.error.code).toBe("INVALID_TITLE");
  });

  it("maps missing document and source to a non-enumerating 404", () => {
    const mapped = toWorkspaceErrorResponse(new DocumentNotFoundError());
    expect(mapped.status).toBe(404);
    expect(mapped.body.error.code).toBe("NOT_FOUND");
    expect(toWorkspaceErrorResponse(new SourceNotFoundError()).status).toBe(404);
  });
});

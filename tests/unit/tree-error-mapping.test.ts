import { describe, expect, it } from "vitest";
import {
  CrossSourceMoveError,
  DomainError,
  FolderNotEmptyError,
  HubManagedOperationRequiredError,
  InvalidParentError,
  TreeCycleError,
  TreeNodeNotFoundError,
  ValidationError,
} from "@/modules/knowledge/domain/errors";
import { toWorkspaceErrorResponse } from "@/server/http-error-response";

/**
 * The tree and folder commands existed before the web could call them, and their error codes were
 * never given a status: the first call from a route would have been a 500 "unexpected error" for
 * "this folder is not empty". Daily-driver spec §7.1.
 */
describe("tree and folder error mapping", () => {
  it("hides a missing tree node as a generic 404, like every other ID that may or may not be yours", () => {
    const mapped = toWorkspaceErrorResponse(new TreeNodeNotFoundError("Parent folder was not found."));
    expect(mapped.status).toBe(404);
    expect(mapped.body.error.code).toBe("NOT_FOUND");
    // Nothing of the domain's own wording: it names what was looked up.
    expect(JSON.stringify(mapped.body)).not.toContain("Parent folder");
  });

  it.each([
    ["FOLDER_NOT_EMPTY", new FolderNotEmptyError()],
    ["TREE_CYCLE", new TreeCycleError()],
    ["INVALID_PARENT", new InvalidParentError()],
    ["CROSS_SOURCE_MOVE", new CrossSourceMoveError()],
    ["HUB_MANAGED_OPERATION_REQUIRED", new HubManagedOperationRequiredError()],
  ])("maps %s to a 409 that keeps its code and its message", (code, error) => {
    const mapped = toWorkspaceErrorResponse(error);
    expect(mapped.status).toBe(409);
    expect(mapped.body.error.code).toBe(code);
    expect(mapped.body.error.message).toBe(error.message);
  });

  it("still maps a bad folder name to 400, as it did", () => {
    expect(toWorkspaceErrorResponse(new ValidationError("Folder name must be a non-empty string."))).toMatchObject({
      status: 400,
      body: { error: { code: "VALIDATION_ERROR" } },
    });
  });

  it("leaves a code nobody listed as a 500 that says nothing about it", () => {
    const mapped = toWorkspaceErrorResponse(new DomainError("SOME_NEW_TREE_CODE", "a detail that must not leave the server"));
    expect(mapped.status).toBe(500);
    expect(mapped.body.error.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(mapped.body)).not.toContain("detail");
  });
});

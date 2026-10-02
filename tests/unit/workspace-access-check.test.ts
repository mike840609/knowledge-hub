import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestWorkspaceAccessCheck } from "@/components/shell/use-workspace-authorization";

/**
 * A refusal that might mean the caller's access changed makes the shell re-check it, and while it does
 * every mutation is paused and "Unable to confirm workspace" is shown. That is the right price for a 403
 * and the wrong one for being told a folder is not empty.
 */
describe("when a failed request makes the shell re-check access", () => {
  const dispatched = vi.fn();
  beforeEach(() => vi.stubGlobal("window", { dispatchEvent: dispatched }));
  afterEach(() => {
    dispatched.mockReset();
    vi.unstubAllGlobals();
  });
  const checked = () => dispatched.mock.calls.filter(([event]) => (event as Event).type === "kh:workspace-access-check").length;
  const refreshed = () => dispatched.mock.calls.filter(([event]) => (event as Event).type === "kh:workspace-access-refresh").length;

  it.each([[403], [409]])("pauses and re-checks for a %i that may mean access changed", (status) => {
    requestWorkspaceAccessCheck(status);
    expect(checked()).toBe(1);
    expect(refreshed()).toBe(0);
  });

  it("re-checks a 404 without pre-emptively pausing confirmed access", () => {
    requestWorkspaceAccessCheck(404, "NOT_FOUND");
    expect(checked()).toBe(0);
    expect(refreshed()).toBe(1);
  });

  it("re-checks for a 409 that is about the workspace itself", () => {
    requestWorkspaceAccessCheck(409, "WORKSPACE_ARCHIVED");
    expect(checked()).toBe(1);
  });

  it("does not re-check for a request that failed for another reason", () => {
    for (const status of [200, 400, 401, 422, 500]) requestWorkspaceAccessCheck(status);
    expect(checked()).toBe(0);
  });

  it.each([
    ["REVISION_CONFLICT"],
    ["SHARE_LINK_LIMIT_REACHED"],
    ["FOLDER_NOT_EMPTY"],
    ["INVALID_PARENT"],
    ["TREE_CYCLE"],
    ["CROSS_SOURCE_MOVE"],
    ["SOURCE_VERSION_CONFLICT"],
    ["IDENTITY_STATE_CHANGED"],
    ["IMPORT_SNAPSHOT_STALE"],
    ["IMPORT_APPLY_RETRYABLE"],
    ["UPLOAD_ENTRY_CONFLICT"],
    ["SOME_FUTURE_CONTENT_CONFLICT"],
  ])("does not re-check for coded content conflict %s", (code) => {
    requestWorkspaceAccessCheck(409, code);
    expect(checked()).toBe(0);
  });

  it("re-checks for a lifecycle conflict", () => {
    requestWorkspaceAccessCheck(409, "WORKSPACE_LIFECYCLE_VIOLATION");
    expect(checked()).toBe(1);
  });

  it("keeps the conservative re-check for an uncoded 409", () => {
    requestWorkspaceAccessCheck(409);
    expect(checked()).toBe(1);
  });
});

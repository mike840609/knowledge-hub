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

  it.each([[403], [404], [409]])("re-checks for a %i, which may mean access changed", (status) => {
    requestWorkspaceAccessCheck(status);
    expect(checked()).toBe(1);
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
  ])("does not re-check for %s: it is a conflict about content, and the caller's access is what it was", (code) => {
    requestWorkspaceAccessCheck(409, code);
    expect(checked()).toBe(0);
  });

  it("still re-checks when a conflict's code is one it has not been told about", () => {
    requestWorkspaceAccessCheck(409, "SOME_FUTURE_CODE");
    expect(checked()).toBe(1);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { governanceFailure, governanceRequest, GovernanceRequestError } from "@/components/workspaces/governance-error";

afterEach(() => vi.unstubAllGlobals());

describe("governance client boundary", () => {
  it("refreshes affected authorization for denied mutations and retains structured field errors", async () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "TEAM_CREATION_DENIED", message: "Localized server text" } }), { status: 403 })));
    await expect(governanceRequest("/api/workspaces", "POST", { name: "Team" })).rejects.toBeInstanceOf(GovernanceRequestError);
    expect(dispatchEvent.mock.calls.map(([event]) => event.type)).toEqual(["kh:workspace-access-check"]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "INVALID_WORKSPACE_NAME", field: "name", message: "Name required" } }), { status: 400 })));
    try { await governanceRequest("/api/workspaces", "POST", { name: " " }); } catch (error) { expect(governanceFailure(error)).toEqual({ code: "INVALID_WORKSPACE_NAME", field: "name", message: "Name required" }); }
  });

  it("notifies all workspace consumers only after a successful mutation", async () => {
    const dispatchEvent = vi.fn(); const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal("window", { dispatchEvent }); vi.stubGlobal("fetch", fetchMock);
    await governanceRequest("/api/workspaces/team/groups", "DELETE", { externalGroupId: "opaque/group:id" });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ externalGroupId: "opaque/group:id" });
    expect(dispatchEvent.mock.calls.map(([event]) => event.type)).toEqual(["kh:workspace-mutation"]);
  });

  it("re-checks access on an authorization/lifecycle 409 but not on a revision conflict", async () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });

    // A concurrent-edit conflict is not an access change: it must not re-check access.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "REVISION_CONFLICT", message: "stale" } }), { status: 409 })));
    await expect(governanceRequest("/api/documents/x", "PATCH", { title: "t" })).rejects.toBeInstanceOf(GovernanceRequestError);
    expect(dispatchEvent).not.toHaveBeenCalled();

    // A lifecycle 409 still re-checks, since the caller's access may genuinely have changed.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "WORKSPACE_ARCHIVED", message: "archived" } }), { status: 409 })));
    await expect(governanceRequest("/api/workspaces/x", "PATCH", { name: "n" })).rejects.toBeInstanceOf(GovernanceRequestError);
    expect(dispatchEvent.mock.calls.map(([event]) => event.type)).toEqual(["kh:workspace-access-check"]);
  });

  it("does not treat network errors as revoked authorization", async () => {
    const dispatchEvent = vi.fn(); vi.stubGlobal("window", { dispatchEvent }); vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    await expect(governanceRequest("/api/workspaces/team", "PATCH", { name: "Team" })).rejects.toThrow("offline");
    expect(dispatchEvent).not.toHaveBeenCalled();
    expect(governanceFailure(new TypeError("offline")).code).toBe("REQUEST_FAILED");
  });
});

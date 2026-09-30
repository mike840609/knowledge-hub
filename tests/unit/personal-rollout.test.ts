import { describe, expect, it, vi } from "vitest";
import { evaluateWorkspaceCapabilities } from "@/modules/workspaces/application/workspace-authorization";
import { TeamWorkspaceService } from "@/modules/workspaces/application/team-workspace-service";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import type { WorkspaceMembershipRepository } from "@/modules/workspaces/ports/workspace-membership-repository";
import type { WorkspaceUnitOfWork } from "@/modules/workspaces/ports/unit-of-work";
const caller = { ...callerFromIdentity({ id: "user", emp_id: "EMP", name: "Owner", org_code: "ORG" }), personalWorkspaceOnly: "mine", platformCapabilities: ["workspace.create_team" as const] };
describe("personal rollout boundaries", () => {
  it("denies Team grants before reading direct or group membership", async () => {
    const find = vi.fn();
    const caps = await evaluateWorkspaceCapabilities({ workspaceMemberships: { find } as unknown as WorkspaceMembershipRepository }, caller, "team");
    expect([...caps]).toEqual([]);
    expect(find).not.toHaveBeenCalled();
  });
  it("preserves personal owner grants", async () => {
    const find = vi.fn().mockResolvedValue({ role: "OWNER" });
    const caps = await evaluateWorkspaceCapabilities({ workspaceMemberships: { find } as unknown as WorkspaceMembershipRepository }, caller, "mine");
    expect(caps.has("document.write")).toBe(true);
  });
  it("denies creation and lifecycle operations even to an otherwise privileged caller", async () => {
    const run = vi.fn();
    const service = new TeamWorkspaceService({ run } as WorkspaceUnitOfWork);
    await expect(service.createTeamWorkspace(caller, { name: "Team" })).rejects.toMatchObject({ code: "TEAM_CREATION_DENIED" });
    await expect(service.renameTeamWorkspace(caller, "team", "Renamed")).rejects.toMatchObject({ code: "WORKSPACE_NOT_FOUND" });
    await expect(service.archiveTeamWorkspace(caller, "team")).rejects.toMatchObject({ code: "WORKSPACE_NOT_FOUND" });
    await expect(service.restoreTeamWorkspace(caller, "team")).rejects.toMatchObject({ code: "WORKSPACE_NOT_FOUND" });
    expect(run).not.toHaveBeenCalled();
  });
});

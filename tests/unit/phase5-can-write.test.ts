import { describe, expect, it } from "vitest";
import { ROLE_WORKSPACE_CAPABILITIES, type WorkspaceCapability } from "@/modules/workspaces/domain/workspace-capability";
import { deriveWorkspaceActions } from "@/server/workspace-admin";
import type { Workspace } from "@/modules/workspaces/domain/workspace";

const team = {
  id: "0199f500-0000-7000-8000-0000000005c1",
  name: "Team",
  workspaceType: "TEAM",
  lifecycleState: "ACTIVE",
  personalOwnerUserId: null,
} as unknown as Workspace;

const archivedTeam = { ...team, lifecycleState: "ARCHIVED" } as unknown as Workspace;

function actionsFor(role: "OWNER" | "EDITOR" | "VIEWER") {
  return deriveWorkspaceActions(team, new Set<WorkspaceCapability>(ROLE_WORKSPACE_CAPABILITIES[role]));
}

describe("canWrite derivation (spec §8.1)", () => {
  it("is true for roles holding document.write", () => {
    expect(actionsFor("EDITOR").canWrite).toBe(true);
    expect(actionsFor("OWNER").canWrite).toBe(true);
  });

  it("is false for VIEWER", () => {
    expect(actionsFor("VIEWER").canWrite).toBe(false);
  });

  it("is false in an ARCHIVED workspace even when the role holds document.write", () => {
    const actions = deriveWorkspaceActions(archivedTeam, new Set<WorkspaceCapability>(ROLE_WORKSPACE_CAPABILITIES.EDITOR));
    expect(actions.canWrite).toBe(false);
  });
});

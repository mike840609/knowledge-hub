import { describe, expect, it } from "vitest";
import { deriveWorkspaceActions } from "@/server/workspace-admin";
import type { Workspace } from "@/modules/workspaces/domain/workspace";
import {
  ROLE_WORKSPACE_CAPABILITIES,
  type WorkspaceCapability,
} from "@/modules/workspaces/domain/workspace-capability";

const team: Workspace = {
  id: "0199f400-0000-7000-8000-000000000001",
  name: "Team",
  createdAt: new Date("2026-09-16T00:00:00.000Z"),
  updatedAt: new Date("2026-09-16T00:00:00.000Z"),
  workspaceType: "TEAM",
  personalOwnerUserId: null,
  lifecycleState: "ACTIVE",
};

describe("canSearch derivation", () => {
  it("is true for a caller holding document.read", () => {
    const capabilities = new Set<WorkspaceCapability>(ROLE_WORKSPACE_CAPABILITIES.VIEWER);
    expect(deriveWorkspaceActions(team, capabilities).canSearch).toBe(true);
  });

  it("is false for a discover-only caller", () => {
    const capabilities = new Set<WorkspaceCapability>([
      "workspace.discover",
      "source.discover",
      "document.discover",
    ]);
    expect(deriveWorkspaceActions(team, capabilities).canSearch).toBe(false);
  });

  it("stays true on an archived Team, because archived Teams remain readable", () => {
    const archived: Workspace = { ...team, lifecycleState: "ARCHIVED" };
    const capabilities = new Set<WorkspaceCapability>(ROLE_WORKSPACE_CAPABILITIES.VIEWER);
    expect(deriveWorkspaceActions(archived, capabilities).canSearch).toBe(true);
  });
});

describe("discover-vs-read tripwire", () => {
  // Spec §5.3: every assignable role currently holds document.read, so the
  // "discover but not read" branch is unreachable and KnowledgeQueryService
  // may keep its discover-level checks. The moment a bundle can discover
  // without reading, this test fails and the reads MUST move to
  // requireWorkspaceRead in the same change.
  it("no role bundle can discover a document without being able to read it", () => {
    for (const [role, capabilities] of Object.entries(ROLE_WORKSPACE_CAPABILITIES)) {
      const held = new Set<string>(capabilities);
      if (held.has("document.discover")) {
        expect(`${role}:${held.has("document.read")}`).toBe(`${role}:true`);
      }
    }
  });
});

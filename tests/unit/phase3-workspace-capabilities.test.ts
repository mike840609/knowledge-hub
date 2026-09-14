import { describe, expect, it } from "vitest";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import { callerFromPrincipal } from "@/modules/identity/domain/caller-context";
import type { AuthenticatedPrincipal } from "@/modules/identity/domain/authenticated-principal";
import type { TrustedIdentityClaims } from "@/modules/identity/domain/trusted-identity-claims";
import {
  ASSIGNABLE_WORKSPACE_ROLES,
  GROUP_ASSIGNABLE_WORKSPACE_ROLES,
  ROLE_WORKSPACE_CAPABILITIES,
  type WorkspaceCapability,
  type WorkspaceRole,
} from "@/modules/workspaces/domain/workspace-capability";

function sorted(capabilities: readonly WorkspaceCapability[]): string[] {
  return [...capabilities].sort();
}

describe("phase 3 workspace capabilities", () => {
  it("assignable roles are exactly OWNER/ADMIN/EDITOR/VIEWER with no DISCOVERER", () => {
    expect([...ASSIGNABLE_WORKSPACE_ROLES].sort()).toEqual(["ADMIN", "EDITOR", "OWNER", "VIEWER"]);
    expect((ASSIGNABLE_WORKSPACE_ROLES as readonly string[]).includes("DISCOVERER")).toBe(false);
    const check: WorkspaceRole = "OWNER";
    expect(check).toBe("OWNER");
  });

  it("group mappings can grant at most ADMIN, never OWNER", () => {
    expect([...GROUP_ASSIGNABLE_WORKSPACE_ROLES].sort()).toEqual(["ADMIN", "EDITOR", "VIEWER"]);
    expect((GROUP_ASSIGNABLE_WORKSPACE_ROLES as readonly string[]).includes("OWNER")).toBe(false);
  });

  it("VIEWER bundle is exactly discover/read", () => {
    expect(sorted(ROLE_WORKSPACE_CAPABILITIES.VIEWER)).toEqual([
      "document.discover",
      "document.read",
      "source.discover",
      "workspace.discover",
    ]);
  });

  it("EDITOR bundle is VIEWER plus write and source.manage", () => {
    expect(sorted(ROLE_WORKSPACE_CAPABILITIES.EDITOR)).toEqual([
      "document.discover",
      "document.read",
      "document.write",
      "source.discover",
      "source.manage",
      "workspace.discover",
    ]);
  });

  it("ADMIN bundle is EDITOR plus basic membership management and audit read", () => {
    expect(sorted(ROLE_WORKSPACE_CAPABILITIES.ADMIN)).toEqual([
      "audit.read",
      "document.discover",
      "document.read",
      "document.write",
      "membership.manage_basic",
      "source.discover",
      "source.manage",
      "workspace.discover",
    ]);
  });

  it("OWNER bundle holds every workspace capability", () => {
    const all: WorkspaceCapability[] = [
      "workspace.discover",
      "source.discover",
      "document.discover",
      "document.read",
      "document.write",
      "source.manage",
      "membership.manage_basic",
      "membership.manage_admin",
      "membership.manage_owner",
      "workspace.rename",
      "workspace.archive",
      "workspace.restore",
      "audit.read",
    ];
    expect(sorted(ROLE_WORKSPACE_CAPABILITIES.OWNER)).toEqual([...all].sort());
  });

  it("bundles nest strictly VIEWER < EDITOR < ADMIN < OWNER", () => {
    const viewer = new Set(ROLE_WORKSPACE_CAPABILITIES.VIEWER);
    const editor = new Set(ROLE_WORKSPACE_CAPABILITIES.EDITOR);
    const admin = new Set(ROLE_WORKSPACE_CAPABILITIES.ADMIN);
    const owner = new Set(ROLE_WORKSPACE_CAPABILITIES.OWNER);
    for (const cap of viewer) expect(editor.has(cap)).toBe(true);
    for (const cap of editor) expect(admin.has(cap)).toBe(true);
    for (const cap of admin) expect(owner.has(cap)).toBe(true);
    expect(owner.size).toBeGreaterThan(admin.size);
    expect(admin.size).toBeGreaterThan(editor.size);
    expect(editor.size).toBeGreaterThan(viewer.size);
  });

  it("callerFromPrincipal builds CallerContext from resolved Hub identity plus trusted claims only", () => {
    const principal: AuthenticatedPrincipal = {
      identity: { id: "hub-user-1", emp_id: "E001", name: "Alice", org_code: "HRSD" },
      validatedExternalGroupIds: ["grp-1", "grp-2"],
      platformCapabilities: ["workspace.create_team"],
      refreshedAt: new Date("2026-09-14T00:00:00.000Z"),
    };
    const caller = callerFromPrincipal(principal);
    expect(caller.identity).toEqual(principal.identity);
    expect([...caller.validatedExternalGroupIds]).toEqual(["grp-1", "grp-2"]);
    expect([...caller.platformCapabilities]).toEqual(["workspace.create_team"]);
    // Single-parameter factory: no browser-supplied identity/groups/capabilities accepted.
    expect(callerFromPrincipal.length).toBe(1);
  });

  it("trusted claims carry validated server-side groups and platform capabilities with refresh time", () => {
    const claims: TrustedIdentityClaims = {
      externalIdentity: {
        provider: "company-sso",
        subject: "sub-123",
        emp_id: "E001",
        name: "Alice",
        org_code: "HRSD",
      },
      validatedExternalGroupIds: ["grp-1"],
      platformCapabilities: [],
      refreshedAt: new Date("2026-09-14T00:00:00.000Z"),
    };
    expect(claims.externalIdentity.subject).toBe("sub-123");
    expect(claims.refreshedAt).toBeInstanceOf(Date);
  });

  it("legacy callerFromIdentity still builds an unprivileged caller", () => {
    const caller = callerFromIdentity({ id: "hub-user-1", emp_id: "E001", name: "Alice", org_code: "HRSD" });
    expect(caller.identity.id).toBe("hub-user-1");
    expect(caller.validatedExternalGroupIds).toEqual([]);
    expect(caller.platformCapabilities).toEqual([]);
  });
});

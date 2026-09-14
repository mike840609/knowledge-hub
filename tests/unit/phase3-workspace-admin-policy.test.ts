import { describe, expect, it } from "vitest";
import {
  assertGovernanceAuthority,
  type GovernanceActorRole,
} from "@/modules/workspaces/domain/workspace-admin-policy";
import { WorkspaceAccessDeniedError } from "@/modules/workspaces/domain/errors";

function attempt(
  actorRole: GovernanceActorRole,
  target: "direct" | "group",
  beforeRole: "OWNER" | "ADMIN" | "EDITOR" | "VIEWER" | null | undefined,
  afterRole: "OWNER" | "ADMIN" | "EDITOR" | "VIEWER" | null | undefined,
  operation: string,
): string | null {
  try {
    assertGovernanceAuthority({ actorRole, target, beforeRole, afterRole, operation });
    return null;
  } catch (error) {
    if (error instanceof WorkspaceAccessDeniedError) return "DENIED";
    throw error;
  }
}

describe("phase 3 workspace admin policy ceilings (Task 9)", () => {
  it("1. ADMIN manages EDITOR/VIEWER direct grants end to end", () => {
    expect(attempt("ADMIN", "direct", undefined, "EDITOR", "add-member")).toBeNull();
    expect(attempt("ADMIN", "direct", undefined, "VIEWER", "add-member")).toBeNull();
    expect(attempt("ADMIN", "direct", "EDITOR", "VIEWER", "change-member")).toBeNull();
    expect(attempt("ADMIN", "direct", "VIEWER", "EDITOR", "change-member")).toBeNull();
    expect(attempt("ADMIN", "direct", "EDITOR", undefined, "remove-member")).toBeNull();
    expect(attempt("ADMIN", "direct", "VIEWER", undefined, "remove-member")).toBeNull();
  });

  it("2. ADMIN manages EDITOR/VIEWER group mappings only", () => {
    expect(attempt("ADMIN", "group", undefined, "EDITOR", "add-group-mapping")).toBeNull();
    expect(attempt("ADMIN", "group", undefined, "VIEWER", "add-group-mapping")).toBeNull();
    expect(attempt("ADMIN", "group", "EDITOR", "VIEWER", "change-group-mapping")).toBeNull();
    expect(attempt("ADMIN", "group", "VIEWER", undefined, "remove-group-mapping")).toBeNull();
  });

  it("3. any OWNER touch on direct memberships requires actor OWNER", () => {
    // Granting OWNER or ADMIN.
    expect(attempt("ADMIN", "direct", undefined, "OWNER", "add-member")).toBe("DENIED");
    expect(attempt("ADMIN", "direct", undefined, "ADMIN", "add-member")).toBe("DENIED");
    // Changing onto OWNER/ADMIN.
    expect(attempt("ADMIN", "direct", "EDITOR", "OWNER", "change-member")).toBe("DENIED");
    expect(attempt("ADMIN", "direct", "VIEWER", "ADMIN", "change-member")).toBe("DENIED");
    // Changing off OWNER/ADMIN.
    expect(attempt("ADMIN", "direct", "OWNER", "EDITOR", "change-member")).toBe("DENIED");
    expect(attempt("ADMIN", "direct", "ADMIN", "VIEWER", "change-member")).toBe("DENIED");
    // Removing OWNER/ADMIN.
    expect(attempt("ADMIN", "direct", "OWNER", undefined, "remove-member")).toBe("DENIED");
    expect(attempt("ADMIN", "direct", "ADMIN", undefined, "remove-member")).toBe("DENIED");
    // OWNER actor may touch every direct role.
    expect(attempt("OWNER", "direct", undefined, "OWNER", "add-member")).toBeNull();
    expect(attempt("OWNER", "direct", undefined, "ADMIN", "add-member")).toBeNull();
    expect(attempt("OWNER", "direct", "OWNER", "EDITOR", "change-member")).toBeNull();
    expect(attempt("OWNER", "direct", "ADMIN", undefined, "remove-member")).toBeNull();
    expect(attempt("OWNER", "direct", "OWNER", undefined, "remove-member")).toBeNull();
  });

  it("4. Group→ADMIN requires actor OWNER", () => {
    expect(attempt("ADMIN", "group", undefined, "ADMIN", "add-group-mapping")).toBe("DENIED");
    expect(attempt("ADMIN", "group", "EDITOR", "ADMIN", "change-group-mapping")).toBe("DENIED");
    expect(attempt("ADMIN", "group", "ADMIN", "EDITOR", "change-group-mapping")).toBe("DENIED");
    expect(attempt("ADMIN", "group", "ADMIN", undefined, "remove-group-mapping")).toBe("DENIED");
    expect(attempt("OWNER", "group", undefined, "ADMIN", "add-group-mapping")).toBeNull();
    expect(attempt("OWNER", "group", "ADMIN", "EDITOR", "change-group-mapping")).toBeNull();
    expect(attempt("OWNER", "group", "ADMIN", undefined, "remove-group-mapping")).toBeNull();
  });

  it("5. NULL-role rows are never authority and non-managers are denied", () => {
    for (const actorRole of [null, undefined, "EDITOR", "VIEWER"] as const) {
      expect(attempt(actorRole, "direct", undefined, "VIEWER", "add-member")).toBe("DENIED");
      expect(attempt(actorRole, "direct", "VIEWER", "EDITOR", "change-member")).toBe("DENIED");
      expect(attempt(actorRole, "direct", "VIEWER", undefined, "remove-member")).toBe("DENIED");
      expect(attempt(actorRole, "group", undefined, "VIEWER", "add-group-mapping")).toBe("DENIED");
    }
  });

  it("6. group mappings can never carry OWNER even for actor OWNER", () => {
    expect(() =>
      assertGovernanceAuthority({
        actorRole: "OWNER",
        target: "group",
        beforeRole: undefined,
        afterRole: "OWNER",
        operation: "add-group-mapping",
      }),
    ).toThrow(/never grant OWNER/i);
  });
});

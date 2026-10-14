import { describe, expect, it } from "vitest";
import { primaryNavItems, type NavAccess } from "@/components/shell/primary-nav-items";

function access(type: "PERSONAL" | "TEAM", actions: Partial<Record<"canInspectSources" | "canSearch" | "canOpenSettings", boolean>>): NavAccess {
  return {
    workspace: { type },
    actions: { canInspectSources: false, canSearch: false, canOpenSettings: false, ...actions },
  } as unknown as NavAccess;
}

const names = (items: { name: string }[]) => items.map((item) => item.name);
const everything = { canInspectSources: true, canSearch: true, canOpenSettings: true };

describe("primary navigation items", () => {
  it("puts Home and Graph on top in a personal workspace", () => {
    expect(names(primaryNavItems("w1", access("PERSONAL", everything), "top"))).toEqual(["Home", "Graph"]);
  });

  it("has no Home in a team workspace", () => {
    expect(names(primaryNavItems("w1", access("TEAM", everything), "top"))).toEqual(["Graph"]);
  });

  it("never lists Knowledge: the tree is the Knowledge navigation", () => {
    for (const type of ["PERSONAL", "TEAM"] as const) {
      for (const group of ["top", "bottom"] as const) {
        expect(names(primaryNavItems("w1", access(type, everything), group))).not.toContain("Knowledge");
      }
    }
  });

  it("puts the low-frequency destinations in the bottom group, personal", () => {
    expect(names(primaryNavItems("w1", access("PERSONAL", everything), "bottom"))).toEqual(["Sources", "Shares", "Insights", "Settings"]);
  });

  it("shows only Sources and Settings at the bottom of a team workspace", () => {
    expect(names(primaryNavItems("w1", access("TEAM", everything), "bottom"))).toEqual(["Sources", "Settings"]);
  });

  it("drops Settings without canOpenSettings and Sources without canInspectSources", () => {
    expect(names(primaryNavItems("w1", access("TEAM", { canSearch: true }), "bottom"))).toEqual([]);
    expect(names(primaryNavItems("w1", access("PERSONAL", { canOpenSettings: true }), "bottom"))).toEqual(["Insights", "Settings"]);
  });

  it("drops Shares without canSearch", () => {
    expect(names(primaryNavItems("w1", access("PERSONAL", { canInspectSources: true, canOpenSettings: true }), "bottom"))).toEqual(["Sources", "Insights", "Settings"]);
  });

  it("scopes every href to the workspace", () => {
    const all = [...primaryNavItems("abc", access("PERSONAL", everything), "top"), ...primaryNavItems("abc", access("PERSONAL", everything), "bottom")];
    expect(all.map((item) => item.href)).toEqual([
      "/w/abc/home", "/w/abc/graph", "/w/abc/sources", "/w/abc/shares", "/w/abc/profile", "/w/abc/settings",
    ]);
  });
});

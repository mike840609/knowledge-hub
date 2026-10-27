import { describe, expect, it } from "vitest";
import {
  actionsFor,
  availableActions,
  rowMenuSections,
  type ActionContext,
  type ActionTarget,
} from "@/components/actions/action-registry";

const allCapabilities = {
  canWrite: true,
  canImport: true,
  canSearch: true,
  canInspectSources: true,
  canOpenSettings: true,
};

function context(overrides: Partial<ActionContext> = {}): ActionContext {
  return {
    workspaceId: "w1",
    workspaceType: "TEAM",
    can: { ...allCapabilities },
    confirmed: true,
    ...overrides,
  };
}

function target(overrides: Partial<ActionTarget> = {}): ActionTarget {
  return {
    documentId: "d1",
    sourceId: "s1",
    label: "Onboarding",
    ownership: "HUB_MANAGED",
    status: "ACTIVE",
    sourceStatus: "ACTIVE",
    revision: "CURRENT",
    favorite: false,
    ...overrides,
  };
}

const ids = (actions: readonly { id: string }[]) => actions.map((action) => action.id);

describe("action registry — document.open-side-peek", () => {
  it("exists in its own section for an ACTIVE document, row surface only", () => {
    const action = availableActions(context({ target: target() })).find(
      (candidate) => candidate.id === "document.open-side-peek",
    );
    expect(action).toMatchObject({
      label: "Open in side peek",
      group: "document",
      section: "open-in",
      surfaces: ["row"],
    });
    expect(action?.effect).toEqual({ kind: "side-peek", documentId: "d1", sourceId: "s1" });
  });

  it("sits between Move document and Copy for Agent with a rule on each side", () => {
    const sections = rowMenuSections(
      actionsFor("row", context({ workspaceType: "PERSONAL", target: target() })),
    ).map(ids);
    expect(sections).toEqual([
      ["document.copy-link"],
      ["document.share", "document.favorite", "document.duplicate", "document.move"],
      ["document.open-side-peek", "document.open-new-tab"],
      ["document.agent-context", "document.export"],
      ["document.archive"],
    ]);
    const flat = sections.flat();
    expect(flat.indexOf("document.open-side-peek")).toBe(flat.indexOf("document.move") + 1);
    expect(flat.indexOf("document.open-new-tab")).toBe(flat.indexOf("document.agent-context") - 1);
  });
});

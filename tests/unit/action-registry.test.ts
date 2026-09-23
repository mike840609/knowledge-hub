import { describe, expect, it } from "vitest";
import {
  actionsFor,
  availableActions,
  groupActions,
  matchActions,
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
    revision: "CURRENT",
    favorite: false,
    ...overrides,
  };
}

const ids = (actions: readonly { id: string }[]) => actions.map((action) => action.id);

describe("action registry — the workspace capability axis", () => {
  it("offers only what the caller's capabilities allow", () => {
    const none = context({
      can: {
        canWrite: false,
        canImport: false,
        canSearch: false,
        canInspectSources: false,
        canOpenSettings: false,
      },
    });
    expect(ids(availableActions(none))).toEqual(["navigate.knowledge"]);
  });

  it("withholds everything that mutates while access is unconfirmed", () => {
    const unconfirmed = ids(availableActions(context({ confirmed: false, target: target() })));
    expect(unconfirmed).not.toContain("create.document");
    expect(unconfirmed).not.toContain("create.import");
    expect(unconfirmed).not.toContain("document.edit");
    // Reading and the client-local shortcuts are unaffected.
    expect(unconfirmed).toContain("navigate.search");
    expect(unconfirmed).toContain("document.favorite");
  });
});

describe("action registry — the source ownership axis", () => {
  it("does not offer Edit on source-managed content, however capable the caller", () => {
    const managed = availableActions(context({ target: target({ ownership: "SOURCE_MANAGED" }) }));
    expect(ids(managed)).not.toContain("document.edit");
    expect(ids(managed)).toContain("document.open");
  });

  it("offers Edit on hub-managed content", () => {
    expect(ids(availableActions(context({ target: target() })))).toContain("document.edit");
  });
});

describe("action registry — the target state axis", () => {
  it("does not offer Edit on an archived document", () => {
    const archived = availableActions(context({ target: target({ status: "ARCHIVED" }) }));
    expect(ids(archived)).not.toContain("document.edit");
  });

  it("does not offer Edit while a historical revision is being read", () => {
    const historical = availableActions(context({ target: target({ revision: "HISTORICAL" }) }));
    expect(ids(historical)).not.toContain("document.edit");
  });

  it("labels the favorite action by what it would do, not by what is true", () => {
    const off = availableActions(context({ target: target({ favorite: false }) }));
    const on = availableActions(context({ target: target({ favorite: true }) }));
    expect(off.find((action) => action.id === "document.favorite")?.label).toBe("Add to favorites");
    expect(on.find((action) => action.id === "document.favorite")?.label).toBe("Remove from favorites");
  });
});

describe("action registry — surfaces", () => {
  it("keeps Open details out of row menus, because the inspector shows the open document", () => {
    const rows = ids(actionsFor("row", context({ target: target() })));
    expect(rows).not.toContain("document.details");
    expect(ids(actionsFor("palette", context({ target: target() })))).toContain("document.details");
  });

  it("gives the empty state the two things a reader can start with", () => {
    expect(ids(actionsFor("empty", context()))).toEqual(["create.document", "create.import"]);
  });

  it("says \"your first\" only where that is true: a personal workspace, at its empty state", () => {
    const personal = { workspaceType: "PERSONAL" } as const;
    const onboarding = actionsFor("empty", context({ ...personal, onboarding: true }));
    expect(onboarding.find((action) => action.id === "create.import")?.label).toBe(
      "Import your first knowledge source",
    );
    const palette = actionsFor("palette", context(personal));
    expect(palette.find((action) => action.id === "create.import")?.label).toBe("Import knowledge");
  });

  it("offers no rows at all without a target", () => {
    expect(actionsFor("row", context())).toEqual([]);
  });
});

describe("action registry — hrefs", () => {
  it("keeps an archived view archived when it links onwards", () => {
    const archived = availableActions(context({ includeArchived: true, target: target() }));
    const open = archived.find((action) => action.id === "document.open");
    expect(open?.effect).toEqual({
      kind: "navigate",
      href: "/w/w1/knowledge/s1/d1?includeArchived=true",
    });
  });

  it("does not carry the query string into the edit route", () => {
    const archived = availableActions(context({ includeArchived: true, target: target() }));
    const edit = archived.find((action) => action.id === "document.edit");
    expect(edit?.effect).toEqual({ kind: "navigate", href: "/w/w1/knowledge/s1/d1/edit" });
  });
});

describe("action registry — palette matching", () => {
  const actions = actionsFor("palette", context({ target: target() }));

  it("matches a label", () => {
    expect(ids(matchActions(actions, "settings"))).toEqual(["navigate.settings"]);
  });

  it("matches a keyword the label never says", () => {
    expect(ids(matchActions(actions, "new"))).toContain("create.document");
  });

  it("returns everything for an empty query", () => {
    expect(matchActions(actions, "   ")).toHaveLength(actions.length);
  });

  it("groups what it matched, dropping the groups that matched nothing", () => {
    const sections = groupActions(matchActions(actions, "onboarding"));
    expect(sections.map((section) => section.group)).toEqual(["document"]);
  });

  it("matches across groups where a word honestly belongs to both", () => {
    // "Import knowledge" creates one; Sources is where imports are managed.
    expect(ids(matchActions(actions, "import"))).toEqual(["navigate.sources", "create.import"]);
  });
});

describe("action registry — document.share (share-link spec §10.1)", () => {
  const shareOffered = (overrides: Partial<ActionContext>) =>
    ids(availableActions(context({ target: target(), ...overrides }))).includes("document.share");

  it("is offered on an active, current document in My Space, in the row menu and the palette", () => {
    const share = availableActions(context({ workspaceType: "PERSONAL", target: target() })).find((action) => action.id === "document.share");
    expect(share?.label).toBe("Share link…");
    expect(share?.surfaces).toEqual(["palette", "row"]);
    expect(share?.effect).toEqual({ kind: "command", command: "document.open-share", documentId: "d1", sourceId: "s1" });
  });

  it("is offered on SOURCE_MANAGED content: ownership decides writing, not sharing", () => {
    expect(shareOffered({ workspaceType: "PERSONAL", target: target({ ownership: "SOURCE_MANAGED" }) })).toBe(true);
  });

  it("does not depend on the write capability", () => {
    expect(shareOffered({ workspaceType: "PERSONAL", can: { ...allCapabilities, canWrite: false } })).toBe(true);
  });

  it.each([
    ["a Team workspace", { workspaceType: "TEAM" }],
    ["an unconfirmed access check", { workspaceType: "PERSONAL", confirmed: false }],
    ["an archived document", { workspaceType: "PERSONAL", target: target({ status: "ARCHIVED" }) }],
    ["a historical revision", { workspaceType: "PERSONAL", target: target({ revision: "HISTORICAL" }) }],
  ] as const)("is not offered on %s", (_, overrides) => {
    expect(shareOffered(overrides as Partial<ActionContext>)).toBe(false);
  });
});

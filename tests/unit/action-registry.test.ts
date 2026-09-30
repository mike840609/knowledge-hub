import { describe, expect, it } from "vitest";
import {
  actionsFor,
  availableActions,
  groupActions,
  matchActions,
  type ActionContext,
  type ActionSurface,
  type ActionTarget,
  type FolderTarget,
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

function folder(overrides: Partial<FolderTarget> = {}): FolderTarget {
  return {
    nodeId: "n1",
    sourceId: "s1",
    label: "Runbooks",
    ownership: "HUB_MANAGED",
    status: "ACTIVE",
    sourceStatus: "ACTIVE",
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
    // Reading is what makes the graph available: membership, nothing more.
    expect(ids(availableActions(none))).toEqual(["navigate.knowledge", "navigate.graph"]);
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

describe("action registry — what the browser's own menu used to offer", () => {
  it("gives a row back Open in new tab and Copy link", () => {
    const rows = ids(actionsFor("row", context({ target: target() })));
    expect(rows).toContain("document.open-new-tab");
    expect(rows).toContain("document.copy-link");
  });

  it("offers them on content the reader can only read, because both are reading", () => {
    const readOnly = target({ ownership: "SOURCE_MANAGED", status: "ARCHIVED", revision: "HISTORICAL" });
    const none = { canWrite: false, canImport: false, canSearch: true, canInspectSources: false, canOpenSettings: false };
    const rows = ids(actionsFor("row", context({ can: none, confirmed: false, target: readOnly })));
    expect(rows).toEqual(expect.arrayContaining(["document.open-new-tab", "document.copy-link"]));
  });

  it("puts Copy link in the palette too, where it copies the page being read", () => {
    const palette = ids(actionsFor("palette", context({ target: target() })));
    expect(palette).toContain("document.copy-link");
    // A new tab of the page you are already on is not something the palette needs.
    expect(palette).not.toContain("document.open-new-tab");
  });

  it("points both at the same place Open document does", () => {
    const actions = availableActions(context({ includeArchived: true, target: target() }));
    const href = (id: string) => {
      const effect = actions.find((action) => action.id === id)?.effect;
      return effect && "href" in effect ? effect.href : undefined;
    };
    expect(href("document.open-new-tab")).toBe(href("document.open"));
    expect(href("document.copy-link")).toBe(href("document.open"));
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

describe("action registry — shortcuts", () => {
  const byId = (id: string, ctx: ActionContext) =>
    availableActions(ctx).find((action) => action.id === id);

  it("binds C to Create document and E to Edit document", () => {
    expect(byId("create.document", context())?.shortcut).toBe("C");
    expect(byId("document.edit", context({ target: target() }))?.shortcut).toBe("E");
  });

  it("offers no E wherever editing is not offered", () => {
    const withE = (t: ActionTarget) =>
      availableActions(context({ target: t })).filter((action) => action.shortcut === "E");
    expect(withE(target({ ownership: "SOURCE_MANAGED" }))).toEqual([]);
    expect(withE(target({ status: "ARCHIVED" }))).toEqual([]);
    expect(withE(target({ revision: "HISTORICAL" }))).toEqual([]);
  });

  it("gives no two actions the same shortcut", () => {
    const shortcuts = availableActions(context({ target: target() }))
      .map((action) => action.shortcut)
      .filter((shortcut): shortcut is string => Boolean(shortcut));
    expect(new Set(shortcuts).size).toBe(shortcuts.length);
  });
});

describe("action registry — document.backlinks (graph spec §11)", () => {
  it("is offered in the palette for the open document, and never on a row", () => {
    const available = availableActions(context({ target: target() }));
    expect(ids(available)).toContain("document.backlinks");
    expect(ids(actionsFor("palette", context({ target: target() })))).toContain("document.backlinks");
    // The panel it opens describes the document that is open, so a row for some other document cannot offer it.
    expect(ids(actionsFor("row", context({ target: target() })))).not.toContain("document.backlinks");
  });

  it("is reading, so it depends on neither capability nor ownership nor lifecycle", () => {
    const readOnly = context({
      can: { canWrite: false, canImport: false, canSearch: false, canInspectSources: false, canOpenSettings: false },
      confirmed: false,
      target: target({ ownership: "SOURCE_MANAGED", status: "ARCHIVED", revision: "HISTORICAL" }),
    });
    expect(ids(availableActions(readOnly))).toContain("document.backlinks");
  });

  it("is not offered when there is no document to describe", () => {
    expect(ids(availableActions(context()))).not.toContain("document.backlinks");
  });

  it("asks the pane for the Links tab rather than navigating", () => {
    const action = availableActions(context({ target: target() })).find((candidate) => candidate.id === "document.backlinks");
    expect(action?.effect).toEqual({ kind: "command", command: "document.open-links", documentId: "d1", sourceId: "s1" });
  });

  it("is found by the words a reader would use", () => {
    const palette = actionsFor("palette", context({ target: target() }));
    for (const word of ["backlinks", "links", "references", "mentions"]) {
      expect(ids(matchActions(palette, word)), word).toContain("document.backlinks");
    }
  });
});

/** Every combination of the axes, so no cell of the matrix is one nobody thought of. */
function combinations<T extends Record<string, readonly unknown[]>>(axes: T): { [K in keyof T]: T[K][number] }[] {
  let rows: Record<string, unknown>[] = [{}];
  for (const [name, values] of Object.entries(axes)) rows = rows.flatMap((row) => values.map((value) => ({ ...row, [name]: value })));
  return rows as { [K in keyof T]: T[K][number] }[];
}

const FOLDER_ACTIONS = ["folder.new-document", "folder.new-folder", "folder.rename", "folder.archive", "folder.restore"];
const LIFECYCLE_ACTIONS = ["document.archive", "document.restore", ...FOLDER_ACTIONS];

describe("action registry — archiving a document (daily-driver spec §7.2)", () => {
  // Expected values are written out here from the spec's three axes, not read back from the registry.
  const cells = combinations({
    canWrite: [true, false],
    confirmed: [true, false],
    ownership: ["HUB_MANAGED", "SOURCE_MANAGED"],
    status: ["ACTIVE", "ARCHIVED"],
    sourceStatus: ["ACTIVE", "ARCHIVED"],
  } as const);

  it.each(cells)("canWrite=$canWrite confirmed=$confirmed $ownership document $status in a $sourceStatus source", (cell) => {
    const offered = ids(
      availableActions(
        context({
          can: { ...allCapabilities, canWrite: cell.canWrite },
          confirmed: cell.confirmed,
          target: target({ ownership: cell.ownership, status: cell.status, sourceStatus: cell.sourceStatus }),
        }),
      ),
    ).filter((id) => id === "document.archive" || id === "document.restore");
    const mayWrite = cell.canWrite && cell.confirmed && cell.ownership === "HUB_MANAGED";
    const expected = !mayWrite ? [] : cell.status === "ACTIVE" ? ["document.archive"] : cell.sourceStatus === "ACTIVE" ? ["document.restore"] : [];
    expect(offered).toEqual(expected);
  });

  it("offers Restore, not Archive, on a document that is archived on its own in a live source", () => {
    const offered = ids(availableActions(context({ target: target({ status: "ARCHIVED", sourceStatus: "ACTIVE" }) })));
    expect(offered).toContain("document.restore");
    expect(offered).not.toContain("document.archive");
  });

  it("offers neither in an archived source, which would refuse Restore: the source has to come back first", () => {
    const offered = ids(availableActions(context({ target: target({ status: "ARCHIVED", sourceStatus: "ARCHIVED" }) })));
    expect(offered).not.toContain("document.archive");
    expect(offered).not.toContain("document.restore");
  });

  it("puts it last in a row menu, where a menu keeps what is hard to take back", () => {
    const row = ids(actionsFor("row", context({ target: target() })));
    expect(row.at(-1)).toBe("document.archive");
    expect(row).toContain("document.edit");
  });

  it("offers it in the palette for the document being read", () => {
    expect(ids(actionsFor("palette", context({ target: target() })))).toContain("document.archive");
    expect(ids(actionsFor("palette", context({ target: target({ status: "ARCHIVED" }) })))).toContain("document.restore");
  });

  it("is a command for the runner, carrying which document and which source", () => {
    const archive = availableActions(context({ target: target() })).find((action) => action.id === "document.archive");
    expect(archive?.effect).toEqual({ kind: "command", command: "document.archive", documentId: "d1", sourceId: "s1" });
    const restore = availableActions(context({ target: target({ status: "ARCHIVED" }) })).find((action) => action.id === "document.restore");
    expect(restore?.effect).toEqual({ kind: "command", command: "document.restore", documentId: "d1", sourceId: "s1" });
  });

  it("is found by the words a reader would use for it, none of which is what it does", () => {
    const actions = availableActions(context({ target: target() }));
    for (const word of ["delete", "remove", "archive"]) expect(ids(matchActions(actions, word))).toContain("document.archive");
  });

  it("is not on offer where there is no document", () => {
    expect(ids(availableActions(context()))).not.toContain("document.archive");
  });
});

describe("action registry — a folder's actions (daily-driver spec §7.2)", () => {
  const cells = combinations({
    canWrite: [true, false],
    confirmed: [true, false],
    ownership: ["HUB_MANAGED", "SOURCE_MANAGED"],
    status: ["ACTIVE", "ARCHIVED"],
    sourceStatus: ["ACTIVE", "ARCHIVED"],
  } as const);

  it.each(cells)("canWrite=$canWrite confirmed=$confirmed $ownership folder $status in a $sourceStatus source", (cell) => {
    const offered = ids(
      availableActions(
        context({
          can: { ...allCapabilities, canWrite: cell.canWrite },
          confirmed: cell.confirmed,
          folder: folder({ ownership: cell.ownership, status: cell.status, sourceStatus: cell.sourceStatus }),
        }),
      ),
    ).filter((id) => FOLDER_ACTIONS.includes(id));
    const mayWrite = cell.canWrite && cell.confirmed && cell.ownership === "HUB_MANAGED" && cell.sourceStatus === "ACTIVE";
    const expected = !mayWrite ? [] : cell.status === "ACTIVE" ? ["folder.new-document", "folder.new-folder", "folder.rename", "folder.archive"] : ["folder.restore"];
    expect(offered).toEqual(expected);
  });

  it("offers nothing to do to a folder that is not the row's own: without a folder there are no folder actions", () => {
    expect(ids(availableActions(context({ target: target() }))).filter((id) => FOLDER_ACTIONS.includes(id))).toEqual([]);
  });

  it("is row-only: the palette describes the document being read, and has no folder to point at", () => {
    const withFolder = context({ folder: folder() });
    expect(ids(actionsFor("palette", withFolder)).filter((id) => FOLDER_ACTIONS.includes(id))).toEqual([]);
    expect(ids(actionsFor("empty", withFolder)).filter((id) => FOLDER_ACTIONS.includes(id))).toEqual([]);
    expect(ids(actionsFor("row", withFolder))).toEqual(["folder.new-document", "folder.new-folder", "folder.rename", "folder.archive"]);
  });

  it("names its targets: New document goes to the new-document page with the folder, the rest carry the folder's identity", () => {
    const byId = Object.fromEntries(availableActions(context({ folder: folder() })).map((action) => [action.id, action.effect]));
    expect(byId["folder.new-document"]).toEqual({ kind: "navigate", href: "/w/w1/knowledge/new?folder=n1" });
    expect(byId["folder.new-folder"]).toEqual({ kind: "create-folder", sourceId: "s1", parentId: "n1", parentLabel: "Runbooks" });
    expect(byId["folder.rename"]).toEqual({ kind: "folder-command", command: "folder.rename", nodeId: "n1", sourceId: "s1", label: "Runbooks" });
    expect(byId["folder.archive"]).toEqual({ kind: "folder-command", command: "folder.archive", nodeId: "n1", sourceId: "s1", label: "Runbooks" });
    const restore = availableActions(context({ folder: folder({ status: "ARCHIVED" }) })).find((action) => action.id === "folder.restore");
    expect(restore?.effect).toEqual({ kind: "folder-command", command: "folder.restore", nodeId: "n1", sourceId: "s1", label: "Runbooks" });
  });

  it("does not carry the archived view into the new-document link: a new document is not archived", () => {
    const action = availableActions(context({ includeArchived: true, folder: folder() })).find((candidate) => candidate.id === "folder.new-document");
    expect(action?.effect).toEqual({ kind: "navigate", href: "/w/w1/knowledge/new?folder=n1" });
  });

  it("groups them apart from the document's, with a label of their own", () => {
    const sections = groupActions(actionsFor("row", context({ target: target(), folder: folder() })));
    expect(sections.map((section) => section.label)).toEqual(["This document", "This folder"]);
  });
});

describe("action registry — Create folder", () => {
  it("is offered where Create document is, and not to someone who cannot write", () => {
    expect(ids(availableActions(context()))).toContain("create.folder");
    expect(ids(availableActions(context({ can: { ...allCapabilities, canWrite: false } })))).not.toContain("create.folder");
    expect(ids(availableActions(context({ confirmed: false })))).not.toContain("create.folder");
  });

  it("makes a folder at the top of the Notes source", () => {
    const action = availableActions(context()).find((candidate) => candidate.id === "create.folder");
    expect(action?.effect).toEqual({ kind: "create-folder", sourceId: null, parentId: null, parentLabel: null });
  });

  it("is in the palette and in the sidebar's create menu, not on the empty state and not on a row", () => {
    const surfacesOf = (id: string): ActionSurface[] => (availableActions(context()).find((candidate) => candidate.id === id)?.surfaces ?? []) as ActionSurface[];
    expect(surfacesOf("create.folder")).toEqual(["palette", "create"]);
    expect(surfacesOf("create.document")).toEqual(["palette", "empty", "create"]);
  });

  it("is found by 'new', like Create document", () => {
    expect(ids(matchActions(availableActions(context()), "new"))).toEqual(expect.arrayContaining(["create.document", "create.folder"]));
  });
});

describe("action registry — SOURCE_MANAGED content is read-only in the Hub, on every surface", () => {
  const surfaces: ActionSurface[] = ["palette", "row", "empty", "create"];
  it.each(surfaces)("offers no archive, restore or folder action on %s", (surface) => {
    for (const status of ["ACTIVE", "ARCHIVED"] as const) {
      const offered = ids(
        actionsFor(surface, context({ target: target({ ownership: "SOURCE_MANAGED", status }), folder: folder({ ownership: "SOURCE_MANAGED", status }) })),
      );
      expect(offered.filter((id) => LIFECYCLE_ACTIONS.includes(id))).toEqual([]);
    }
  });
});

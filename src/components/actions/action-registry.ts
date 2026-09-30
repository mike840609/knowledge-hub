import type { WorkspaceActions } from "@/server/workspace-admin";

/**
 * The one list of what a reader can do, and where each of those things is
 * allowed to appear.
 *
 * Before this module every action was welded to whichever screen happened to
 * show it — Edit to the document header, Import to the empty state, Archive to
 * the settings panel — and nothing could enumerate them. The palette, the row
 * menu and the empty state each need the same answer to the same question
 * (who, in what situation, may do what to what), so they read it from here
 * rather than deciding it three times and agreeing by luck.
 *
 * This module is deliberately free of React, routing and icons: it returns
 * data. Surfaces turn that data into rows. That is what makes the availability
 * rules testable without a DOM, which matters because they are the part that
 * is easy to get quietly wrong.
 */

export type ActionId =
  | "navigate.home"
  | "navigate.knowledge"
  | "navigate.search"
  | "navigate.graph"
  | "navigate.sources"
  | "navigate.settings"
  | "create.document"
  | "create.folder"
  | "create.import"
  | "document.export"
  | "document.open"
  | "document.open-new-tab"
  | "document.copy-link"
  | "document.edit"
  | "document.share"
  | "document.favorite"
  | "document.details"
  | "document.backlinks"
  | "document.move"
  | "document.archive"
  | "document.restore"
  | "folder.new-document"
  | "folder.new-folder"
  | "folder.rename"
  | "folder.move"
  | "folder.archive"
  | "folder.restore";

export type ActionGroup = "navigate" | "create" | "document" | "folder";

/**
 * Where an action may be offered. A surface renders nothing it did not ask for. `create` is the
 * sidebar's menu of things to start, which is not the palette: it offers what can be *made*, and
 * nothing that can be *found*.
 */
export type ActionSurface = "palette" | "row" | "empty" | "create";

/** Named rather than imported so this module stays free of component imports. */
export type ActionIconName =
  | "new-tab"
  | "copy-link"
  | "knowledge"
  | "search"
  | "graph"
  | "sources"
  | "settings"
  | "create"
  | "import"
  | "open"
  | "edit"
  | "share"
  | "favorite"
  | "details"
  | "backlinks"
  | "new-document"
  | "new-folder"
  | "rename"
  | "move"
  | "archive"
  | "restore";

export type ActionCommand =
  | "document.toggle-favorite"
  | "document.open-details"
  | "document.open-share"
  | "document.open-links"
  | "document.archive"
  | "document.restore";

/** What a folder row can be asked to do that needs a request to the server, or a name from the reader. */
export type FolderCommand = "folder.rename" | "folder.archive" | "folder.restore";

export type ActionEffect =
  | { kind: "download"; href: string }
  | { kind: "navigate"; href: string }
  /** Leaves this tab where it is; what a middle-click on the row's link does. */
  | { kind: "open-new-tab"; href: string }
  /** A path, not a URL: the origin is the browser's to supply, not this module's. */
  | { kind: "copy-link"; href: string }
  | { kind: "command"; command: ActionCommand; documentId: string; sourceId: string; label?: string }
  /**
   * Asks for a name and makes a folder: at the top of the Notes source when `parentId` is null,
   * inside that folder otherwise. `sourceId` is the parent's, or null for the default source.
   */
  | { kind: "create-folder"; sourceId: string | null; parentId: string | null; parentLabel: string | null }
  | { kind: "folder-command"; command: FolderCommand; nodeId: string; sourceId: string; label: string }
  /** Asks for a place — a folder, or the top level — and moves the node there, last. */
  | { kind: "move"; sourceId: string; label: string; node: { type: "document"; documentId: string } | { type: "folder"; nodeId: string } };

export type Action = {
  id: ActionId;
  /** Imperative, and complete on its own: a palette row has no surrounding context. */
  label: string;
  group: ActionGroup;
  icon: ActionIconName;
  /** Extra words the palette matches on, so "new" finds "Create document". */
  keywords: readonly string[];
  /** `aria-keyshortcuts` spelling, where one exists. */
  shortcut?: string;
  surfaces: readonly ActionSurface[];
  effect: ActionEffect;
};

/**
 * The document an action would act on. Ownership and status are carried
 * because they answer a different question from workspace access: a viewer
 * with `canWrite` still may not edit `SOURCE_MANAGED` content.
 */
export type ActionTarget = {
  documentId: string;
  sourceId: string;
  label: string;
  ownership: "SOURCE_MANAGED" | "HUB_MANAGED";
  /**
   * ACTIVE only when the document *and* its source are: an archived collection's documents read as
   * archived, because nothing may be done to them. Which of the two it is matters for exactly one
   * thing, restoring, so the source's own state is here as well.
   */
  status: "ACTIVE" | "ARCHIVED";
  sourceStatus: "ACTIVE" | "ARCHIVED";
  /** A historical revision is a reading view: it is not the document's current state. */
  revision: "CURRENT" | "HISTORICAL";
  favorite: boolean;
};

/**
 * The folder an action would act on. A folder is a place in one source's tree, so what may be done
 * to it follows the same three axes as a document: the caller, the source's ownership, and its own
 * state — plus the state of the source it is in, which is why that is carried too.
 */
export type FolderTarget = {
  nodeId: string;
  sourceId: string;
  label: string;
  ownership: "SOURCE_MANAGED" | "HUB_MANAGED";
  /** The folder's own lifecycle. */
  status: "ACTIVE" | "ARCHIVED";
  sourceStatus: "ACTIVE" | "ARCHIVED";
};

export type ActionContext = {
  workspaceId: string;
  workspaceType: "PERSONAL" | "TEAM";
  /** Capabilities as the server derived them — never a claim read off the URL. */
  can: Pick<
    WorkspaceActions,
    "canWrite" | "canImport" | "canSearch" | "canInspectSources" | "canOpenSettings"
  >;
  /** False while an access re-check is in flight; nothing that mutates is offered then. */
  confirmed: boolean;
  /** Carried through so a link out of an archived view stays in that view. */
  includeArchived?: boolean;
  /**
   * Set by the empty state, which is by definition someone's first look at a
   * workspace with nothing in it. It only changes wording, and only there —
   * "your first" would be a lie in a palette opened on a full workspace.
   */
  onboarding?: boolean;
  target?: ActionTarget;
  /** A folder row's own target; a surface has a document or a folder to describe, not both. */
  folder?: FolderTarget;
};

/**
 * Availability has three axes, and conflating them is the mistake this
 * codebase is most exposed to:
 *
 *   1. workspace capability — `canWrite`, `canImport`, `canOpenSettings`, …
 *   2. source ownership — `SOURCE_MANAGED` content is read-only in the Hub
 *      however capable the caller is
 *   3. target state — an archived document offers reading, not editing
 *
 * And the rule that outranks all three: this decides what is *shown*. The
 * application service decides what *happens*. An action hidden here must
 * still be refused by the server, because knowing an ID is not authorization.
 */
export function availableActions(context: ActionContext): readonly Action[] {
  const { workspaceId, can, confirmed, target, folder } = context;
  const archived = context.includeArchived === true;
  const suffix = archived ? "?includeArchived=true" : "";
  const actions: Action[] = [];
  if (context.workspaceType === "PERSONAL") actions.push({ id: "navigate.home", label: "Go to My Space home", group: "navigate", icon: "knowledge", keywords: ["drafts", "favorites", "recent", "export"], surfaces: ["palette"], effect: { kind: "navigate", href: `/w/${workspaceId}/home` } });

  actions.push({
    id: "navigate.knowledge",
    label: "Go to Knowledge",
    group: "navigate",
    icon: "knowledge",
    keywords: ["documents", "tree", "browse"],
    surfaces: ["palette"],
    effect: { kind: "navigate", href: `/w/${workspaceId}/knowledge${suffix}` },
  });
  // Reading Knowledge is what makes a graph of it available; no capability
  // beyond membership, so it is offered wherever Go to Knowledge is (graph spec §11).
  actions.push({
    id: "navigate.graph",
    label: "Open graph",
    group: "navigate",
    icon: "graph",
    keywords: ["links", "network", "map", "relationships", "backlinks", "connections"],
    surfaces: ["palette"],
    effect: { kind: "navigate", href: `/w/${workspaceId}/graph` },
  });
  if (can.canSearch) {
    actions.push({
      id: "navigate.search",
      label: "Open full search",
      group: "navigate",
      icon: "search",
      keywords: ["find", "query"],
      surfaces: ["palette"],
      effect: { kind: "navigate", href: `/w/${workspaceId}/search` },
    });
  }
  if (can.canInspectSources) {
    actions.push({
      id: "navigate.sources",
      label: "Go to Sources",
      group: "navigate",
      icon: "sources",
      keywords: ["folders", "sync", "imports"],
      surfaces: ["palette"],
      effect: { kind: "navigate", href: `/w/${workspaceId}/sources` },
    });
  }
  if (can.canOpenSettings) {
    actions.push({
      id: "navigate.settings",
      label: "Go to Settings",
      group: "navigate",
      icon: "settings",
      keywords: ["members", "groups", "audit", "rename", "archive"],
      surfaces: ["palette"],
      effect: { kind: "navigate", href: `/w/${workspaceId}/settings` },
    });
  }

  if (can.canWrite && confirmed) {
    actions.push({
      id: "create.document",
      // "Create", because the key is C. The noun is the one the rest of the
      // product uses (Edit document, Open document); where it goes, Notes,
      // is a keyword rather than the label.
      label: "Create document",
      group: "create",
      icon: "create",
      keywords: ["new", "add", "note", "notes", "write"],
      shortcut: "C",
      surfaces: ["palette", "empty", "create"],
      effect: { kind: "navigate", href: `/w/${workspaceId}/knowledge/new` },
    });
    // The same gate as a document, for the same reason: it writes to the Notes source, which
    // is made on first use. Not on the empty state, which offers a place to start writing.
    actions.push({
      id: "create.folder",
      label: "Create folder",
      group: "create",
      icon: "new-folder",
      keywords: ["new", "add", "directory", "organize", "group", "notes"],
      surfaces: ["palette", "create"],
      effect: { kind: "create-folder", sourceId: null, parentId: null, parentLabel: null },
    });
  }
  if (can.canImport && confirmed) {
    actions.push({
      id: "create.import",
      label:
        context.onboarding && context.workspaceType === "PERSONAL"
          ? "Import your first knowledge source"
          : "Import knowledge",
      group: "create",
      icon: "import",
      keywords: ["folder", "upload", "sync", "source"],
      surfaces: ["palette", "empty"],
      effect: { kind: "navigate", href: `/w/${workspaceId}/sources/import` },
    });
  }

  if (target) {
    actions.push({ id: "document.export", label: "Download Markdown", group: "document", icon: "open", keywords: ["export", "download", "markdown"], surfaces: ["palette", "row"], effect: { kind: "download", href: `/api/documents/${target.documentId}/export` } });
    const documentHref = `/w/${workspaceId}/knowledge/${target.sourceId}/${target.documentId}${suffix}`;
    actions.push({
      id: "document.open",
      label: "Open document",
      group: "document",
      icon: "open",
      keywords: [target.label],
      surfaces: ["row"],
      effect: { kind: "navigate", href: documentHref },
    });
    // A row's link used to answer right-click with the browser's own menu,
    // which offers these two. Replacing that menu took them away, so the
    // replacement has to give them back — a context menu that is poorer than
    // the one it displaced is a regression, however much it adds.
    actions.push({
      id: "document.open-new-tab",
      label: "Open in new tab",
      group: "document",
      icon: "new-tab",
      keywords: ["tab", "window", target.label],
      surfaces: ["row"],
      effect: { kind: "open-new-tab", href: documentHref },
    });
    actions.push({
      id: "document.copy-link",
      label: "Copy link",
      group: "document",
      icon: "copy-link",
      keywords: ["share", "url", "address", target.label],
      // The palette's target is the document being read, so this is also
      // "copy a link to this page" — which has no other home.
      surfaces: ["palette", "row"],
      effect: { kind: "copy-link", href: documentHref },
    });
    // All three axes at once: the capability, then the ownership, then the
    // state of the document itself.
    if (
      can.canWrite &&
      confirmed &&
      target.ownership === "HUB_MANAGED" &&
      target.status === "ACTIVE" &&
      target.revision === "CURRENT"
    ) {
      actions.push({
        id: "document.edit",
        label: "Edit document",
        group: "document",
        icon: "edit",
        keywords: ["rename", "title", "write", target.label],
        shortcut: "E",
        surfaces: ["palette", "row"],
        effect: { kind: "navigate", href: `${documentHref.split("?")[0]}/edit` },
      });
    }
    // Share-link spec §10.1. Ownership is deliberately not consulted: sharing
    // is reading, and SOURCE_MANAGED content is as readable as any other. A
    // historical revision is excluded because the link always shows the
    // current one, and offering it there would suggest otherwise.
    if (
      context.workspaceType === "PERSONAL" &&
      confirmed &&
      target.status === "ACTIVE" &&
      target.revision === "CURRENT"
    ) {
      actions.push({
        id: "document.share",
        label: "Share link…",
        group: "document",
        icon: "share",
        keywords: ["link", "share", "copy link", "public", target.label],
        surfaces: ["palette", "row"],
        effect: {
          kind: "command",
          command: "document.open-share",
          documentId: target.documentId,
          sourceId: target.sourceId,
        },
      });
    }
    actions.push({
      id: "document.favorite",
      label: target.favorite ? "Remove from favorites" : "Add to favorites",
      group: "document",
      icon: "favorite",
      keywords: ["star", "bookmark", target.label],
      surfaces: ["palette", "row"],
      effect: {
        kind: "command",
        command: "document.toggle-favorite",
        documentId: target.documentId,
        sourceId: target.sourceId,
      },
    });
    actions.push({
      id: "document.details",
      label: "Open details",
      group: "document",
      icon: "details",
      keywords: ["inspector", "metadata", "revisions", target.label],
      shortcut: "Meta+I Control+I",
      // Palette only: the inspector describes the document currently open, so
      // offering it on some other row would promise a panel that cannot show it.
      surfaces: ["palette"],
      effect: {
        kind: "command",
        command: "document.open-details",
        documentId: target.documentId,
        sourceId: target.sourceId,
      },
    });
    // Graph spec §11. Palette only, for the same reason as Open details: the
    // panel it opens describes the document currently open, so offering it on
    // some other row would promise a view that cannot show that row. Reading,
    // so it depends on neither capability nor ownership — and it is offered on
    // a historical revision too, whose own links the panel then shows.
    actions.push({
      id: "document.backlinks",
      label: "Show backlinks",
      group: "document",
      icon: "backlinks",
      keywords: ["links", "references", "linked", "mentions", "graph", target.label],
      surfaces: ["palette"],
      effect: {
        kind: "command",
        command: "document.open-links",
        documentId: target.documentId,
        sourceId: target.sourceId,
      },
    });
    // The same three axes as Edit, plus the source's own state: a source that is archived refuses
    // every change to what is in it, and a move is one. Before Archive, which stays last.
    if (can.canWrite && confirmed && target.ownership === "HUB_MANAGED" && target.status === "ACTIVE" && target.sourceStatus === "ACTIVE") {
      actions.push({
        id: "document.move",
        label: "Move document…",
        group: "document",
        icon: "move",
        keywords: ["folder", "relocate", "put", "organize", "file", target.label],
        surfaces: ["palette", "row"],
        effect: { kind: "move", sourceId: target.sourceId, label: target.label, node: { type: "document", documentId: target.documentId } },
      });
    }
    // Last in the group, where a menu keeps what is hard to take back. This is not deleting: an
    // archived document keeps every revision and its place, and Restore puts it back (the
    // lifecycle is ACTIVE or ARCHIVED, and nothing else). All three axes, as Edit has them: the
    // caller, the ownership, the state. Restore is not offered inside an archived source, which
    // would refuse it: the source has to come back first.
    if (can.canWrite && confirmed && target.ownership === "HUB_MANAGED") {
      if (target.status === "ACTIVE") {
        actions.push({
          id: "document.archive",
          label: "Archive document",
          group: "document",
          icon: "archive",
          keywords: ["delete", "remove", "hide", "trash", target.label],
          surfaces: ["palette", "row"],
          effect: { kind: "command", command: "document.archive", documentId: target.documentId, sourceId: target.sourceId, label: target.label },
        });
      } else if (target.sourceStatus === "ACTIVE") {
        actions.push({
          id: "document.restore",
          label: "Restore document",
          group: "document",
          icon: "restore",
          keywords: ["unarchive", "undo", "bring back", target.label],
          surfaces: ["palette", "row"],
          effect: { kind: "command", command: "document.restore", documentId: target.documentId, sourceId: target.sourceId, label: target.label },
        });
      }
    }
  }

  if (folder && can.canWrite && confirmed && folder.ownership === "HUB_MANAGED" && folder.sourceStatus === "ACTIVE") {
    const identity = { nodeId: folder.nodeId, sourceId: folder.sourceId, label: folder.label };
    if (folder.status === "ACTIVE") {
      actions.push({
        id: "folder.new-document",
        label: "New document here",
        group: "folder",
        icon: "new-document",
        keywords: ["create", "add", "note", "write", folder.label],
        surfaces: ["row"],
        effect: { kind: "navigate", href: `/w/${workspaceId}/knowledge/new?folder=${folder.nodeId}` },
      });
      actions.push({
        id: "folder.new-folder",
        label: "New folder here",
        group: "folder",
        icon: "new-folder",
        keywords: ["create", "add", "subfolder", "nest", folder.label],
        surfaces: ["row"],
        effect: { kind: "create-folder", sourceId: folder.sourceId, parentId: folder.nodeId, parentLabel: folder.label },
      });
      actions.push({
        id: "folder.rename",
        label: "Rename folder",
        group: "folder",
        icon: "rename",
        keywords: ["name", "title", folder.label],
        surfaces: ["row"],
        effect: { kind: "folder-command", command: "folder.rename", ...identity },
      });
      actions.push({
        id: "folder.move",
        label: "Move folder…",
        group: "folder",
        icon: "move",
        keywords: ["relocate", "put", "nest", "organize", folder.label],
        surfaces: ["row"],
        effect: { kind: "move", sourceId: folder.sourceId, label: folder.label, node: { type: "folder", nodeId: folder.nodeId } },
      });
      actions.push({
        id: "folder.archive",
        label: "Archive folder",
        group: "folder",
        icon: "archive",
        keywords: ["delete", "remove", "hide", folder.label],
        surfaces: ["row"],
        effect: { kind: "folder-command", command: "folder.archive", ...identity },
      });
    } else {
      actions.push({
        id: "folder.restore",
        label: "Restore folder",
        group: "folder",
        icon: "restore",
        keywords: ["unarchive", "undo", "bring back", folder.label],
        surfaces: ["row"],
        effect: { kind: "folder-command", command: "folder.restore", ...identity },
      });
    }
  }

  return actions;
}

/** The actions one surface may show, in registry order. */
export function actionsFor(surface: ActionSurface, context: ActionContext): readonly Action[] {
  return availableActions(context).filter((action) => action.surfaces.includes(surface));
}

/**
 * Palette matching. Label first, keywords second, both case-insensitively and
 * on substrings — someone typing "imp" is looking for Import, and someone
 * typing "new" is looking for a note they would not think to call "Add".
 */
export function matchActions(actions: readonly Action[], query: string): readonly Action[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return actions;
  return actions.filter(
    (action) =>
      action.label.toLowerCase().includes(needle) ||
      action.keywords.some((keyword) => keyword.toLowerCase().includes(needle)),
  );
}

export const actionGroupLabels: Record<ActionGroup, string> = {
  navigate: "Go to",
  create: "Create",
  document: "This document",
  folder: "This folder",
};

/** Registry order within a group is meaningful; group order is this. */
export const actionGroupOrder: readonly ActionGroup[] = ["document", "folder", "create", "navigate"];

export function groupActions(
  actions: readonly Action[],
): readonly { group: ActionGroup; label: string; actions: readonly Action[] }[] {
  return actionGroupOrder
    .map((group) => ({
      group,
      label: actionGroupLabels[group],
      actions: actions.filter((action) => action.group === group),
    }))
    .filter((section) => section.actions.length > 0);
}

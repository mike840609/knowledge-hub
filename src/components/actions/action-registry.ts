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
  | "navigate.knowledge"
  | "navigate.search"
  | "navigate.sources"
  | "navigate.settings"
  | "create.document"
  | "create.import"
  | "document.open"
  | "document.open-new-tab"
  | "document.copy-link"
  | "document.edit"
  | "document.share"
  | "document.favorite"
  | "document.details";

export type ActionGroup = "navigate" | "create" | "document";

/** Where an action may be offered. A surface renders nothing it did not ask for. */
export type ActionSurface = "palette" | "row" | "empty";

/** Named rather than imported so this module stays free of component imports. */
export type ActionIconName =
  | "new-tab"
  | "copy-link"
  | "knowledge"
  | "search"
  | "sources"
  | "settings"
  | "create"
  | "import"
  | "open"
  | "edit"
  | "share"
  | "favorite"
  | "details";

export type ActionCommand = "document.toggle-favorite" | "document.open-details" | "document.open-share";

export type ActionEffect =
  | { kind: "navigate"; href: string }
  /** Leaves this tab where it is; what a middle-click on the row's link does. */
  | { kind: "open-new-tab"; href: string }
  /** A path, not a URL: the origin is the browser's to supply, not this module's. */
  | { kind: "copy-link"; href: string }
  | { kind: "command"; command: ActionCommand; documentId: string; sourceId: string };

export type Action = {
  id: ActionId;
  /** Imperative, and complete on its own: a palette row has no surrounding context. */
  label: string;
  group: ActionGroup;
  icon: ActionIconName;
  /** Extra words the palette matches on, so "new" finds "Add to Notes". */
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
  status: "ACTIVE" | "ARCHIVED";
  /** A historical revision is a reading view: it is not the document's current state. */
  revision: "CURRENT" | "HISTORICAL";
  favorite: boolean;
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
  const { workspaceId, can, confirmed, target } = context;
  const archived = context.includeArchived === true;
  const suffix = archived ? "?includeArchived=true" : "";
  const actions: Action[] = [];

  actions.push({
    id: "navigate.knowledge",
    label: "Go to Knowledge",
    group: "navigate",
    icon: "knowledge",
    keywords: ["documents", "tree", "browse"],
    surfaces: ["palette"],
    effect: { kind: "navigate", href: `/w/${workspaceId}/knowledge${suffix}` },
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
      label: "Add to Notes",
      group: "create",
      icon: "create",
      keywords: ["new", "note", "document", "write"],
      surfaces: ["palette", "empty"],
      effect: { kind: "navigate", href: `/w/${workspaceId}/knowledge/new` },
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
};

/** Registry order within a group is meaningful; group order is this. */
export const actionGroupOrder: readonly ActionGroup[] = ["document", "create", "navigate"];

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

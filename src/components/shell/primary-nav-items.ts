import { Database, Home, Network, Settings, Share2, UserRound, type LucideIcon } from "lucide-react";
import type { WorkspaceAccessView } from "@/server/workspace-admin";

export type NavGroup = "top" | "bottom";
export type NavItem = { name: string; href: string; Icon: LucideIcon };
export type NavAccess = Pick<WorkspaceAccessView, "workspace" | "actions">;

/**
 * The sidebar's navigation. `top` sits above the tree and is always on screen; `bottom` scrolls after
 * it, because a group pinned to the bottom either floats far below a short tree or takes room from a
 * long one. There is no Knowledge item: the tree is the Knowledge navigation.
 */
export function primaryNavItems(workspaceId: string, access: NavAccess, group: NavGroup): NavItem[] {
  const base = `/w/${workspaceId}`;
  const personal = access.workspace.type === "PERSONAL";
  if (group === "top") {
    return [
      ...(personal ? [{ name: "Home", href: `${base}/home`, Icon: Home }] : []),
      { name: "Graph", href: `${base}/graph`, Icon: Network },
    ];
  }
  return [
    ...(access.actions.canInspectSources ? [{ name: "Sources", href: `${base}/sources`, Icon: Database }] : []),
    ...(personal && access.actions.canSearch ? [{ name: "Shares", href: `${base}/shares`, Icon: Share2 }] : []),
    ...(personal ? [{ name: "Insights", href: `${base}/profile`, Icon: UserRound }] : []),
    ...(access.actions.canOpenSettings ? [{ name: "Settings", href: `${base}/settings`, Icon: Settings }] : []),
  ];
}

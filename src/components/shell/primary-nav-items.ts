import { Database, Home, Network, Settings, Share2, UserRound, type LucideIcon } from "lucide-react";
import type { WorkspaceAccessView } from "@/server/workspace-admin";

export type NavGroup = "top" | "bottom";
export type NavItem = { name: string; href: string; Icon: LucideIcon };
export type NavAccess = Pick<WorkspaceAccessView, "workspace" | "actions">;

/**
 * The sidebar's navigation, in two labelled groups that both sit above the tree: `top` (Home, Graph) and
 * `bottom` (the low-frequency destinations). Nothing follows the tree, whose length varies, so no item
 * moves as it grows. There is no Knowledge item: the tree is the Knowledge navigation.
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

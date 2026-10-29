"use client";

import Link from "next/link";
import { ActionIcon } from "@/components/actions/action-icon";
import { useWorkspaceAuthorization } from "@/components/shell/use-workspace-authorization";
import { buttonClasses } from "@/components/ui/button";
import { startActions } from "@/components/knowledge/sidebar-get-started";

/**
 * The ways to add a first document, as every empty state offers them: read from the registry's `empty`
 * surface, so each page names them as the Knowledge explorer does. The first is the primary one, so
 * two equal-weight buttons never ask the reader to choose. Nothing is offered until the shell has
 * confirmed this workspace's capabilities.
 */
export function WorkspaceContentActions({ workspaceId }: { workspaceId: string }) {
  const { access, confirmed } = useWorkspaceAuthorization();
  if (!confirmed || access.workspace.id !== workspaceId) return null;
  const actions = startActions({ workspaceId, workspaceType: access.workspace.type, isPersonalOwner: access.isPersonalOwner, can: access.actions, confirmed });
  return <>
    {actions.map((action, index) =>
      action.effect.kind === "navigate" ? (
        <Link key={action.id} className={buttonClasses({ size: "lg", variant: index === 0 ? "primary" : "secondary" })} href={action.effect.href}>
          <ActionIcon name={action.icon} className="h-4 w-4 shrink-0" />
          {action.label}
        </Link>
      ) : null,
    )}
  </>;
}

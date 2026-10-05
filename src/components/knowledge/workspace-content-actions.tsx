"use client";

import Link from "next/link";
import { useWorkspaceAuthorization } from "@/components/shell/use-workspace-authorization";
import { buttonClasses } from "@/components/ui/button";

/** Empty-state actions use the shell's confirmed capabilities, just like the toolbar. */
export function WorkspaceContentActions({ workspaceId }: { workspaceId: string }) {
  const { access, confirmed } = useWorkspaceAuthorization();
  if (!confirmed || access.workspace.id !== workspaceId) return null;
  return <>
    {access.actions.canImport ? <Link className={buttonClasses()} href={`/w/${workspaceId}/sources/import`}>Import folder</Link> : null}
    {access.actions.canWrite ? <Link className={buttonClasses({ variant: access.actions.canImport ? "secondary" : "primary" })} href={`/w/${workspaceId}/knowledge/new`}>Create note</Link> : null}
  </>;
}

"use client";

import { Share2 } from "lucide-react";
import { requestShare } from "@/components/actions/action-menu";
import { useSharedTargets } from "@/components/knowledge/shared-folders";
import { useWorkspaceAuthorization } from "@/components/shell/use-workspace-authorization";
import { buttonClasses } from "@/components/ui/button";

type Props = { workspaceId: string; sourceId: string; sourceName: string; status: string };

function useCanShareSource(status: string) {
  const { access, confirmed } = useWorkspaceAuthorization();
  return confirmed && access.workspace.type === "PERSONAL" && access.isPersonalOwner && status === "ACTIVE";
}

export function SourceShareAction({ sourceId, sourceName, status }: Props) {
  const allowed = useCanShareSource(status);
  if (!allowed) return null;
  return <button type="button" aria-label={`Share source ${sourceName}`} className={buttonClasses({ variant: "ghost", icon: true })} onClick={() => requestShare({ sourceId, name: sourceName })}><Share2 size={16} aria-hidden="true" /></button>;
}

export function SourceSharedMarker({ workspaceId, sourceId, status }: Omit<Props, "sourceName">) {
  const allowed = useCanShareSource(status);
  const { sourceIds } = useSharedTargets(workspaceId, allowed);
  return allowed && sourceIds.has(sourceId) ? <Share2 size={14} aria-label="Shared" className="shrink-0 text-kh-text-muted" /> : null;
}

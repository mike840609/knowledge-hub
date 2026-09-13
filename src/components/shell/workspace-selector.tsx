"use client";

import { useRouter } from "next/navigation";
import type { WorkspaceView } from "@/modules/workspaces/application/workspace-query-service";

export function WorkspaceSelector({
  workspaces,
  workspaceId,
}: {
  workspaces: WorkspaceView[];
  workspaceId: string;
}) {
  const router = useRouter();
  return (
    <select
      aria-label="Workspace"
      value={workspaceId}
      onChange={(event) => {
        const nextId = event.target.value;
        if (nextId !== workspaceId) router.push(`/w/${nextId}/knowledge`);
      }}
      className="h-8 max-w-56 truncate rounded border border-kh-border bg-kh-bg px-2 text-sm text-kh-text outline-none focus-visible:ring-2 focus-visible:ring-kh-accent"
    >
      {workspaces.map((workspace) => (
        <option key={workspace.id} value={workspace.id}>
          {workspace.name}
        </option>
      ))}
    </select>
  );
}

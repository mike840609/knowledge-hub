import type { WorkspaceShellModel } from "@/server/knowledge-read";
import { WorkspaceSelector } from "@/components/shell/workspace-selector";

export function Topbar({ model }: { model: WorkspaceShellModel }) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-kh-border bg-kh-bg px-3">
      <span className="text-sm font-semibold text-kh-text">Knowledge Hub</span>
      <WorkspaceSelector workspaces={model.workspaces} workspaceId={model.workspace.id} />
      <span className="ml-auto truncate text-sm text-kh-text-muted">{model.identityName}</span>
    </header>
  );
}

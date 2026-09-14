import { Menu } from "lucide-react";
import type { WorkspaceShellModel } from "@/server/knowledge-read";
import { WorkspaceSelector } from "@/components/shell/workspace-selector";

export function Topbar({
  model,
  onMenuClick,
}: {
  model: WorkspaceShellModel;
  onMenuClick?: () => void;
}) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-kh-border bg-kh-bg px-3">
      {onMenuClick ? (
        <button
          type="button"
          aria-label="Open menu"
          onClick={onMenuClick}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-kh-text-muted hover:bg-kh-bg-hover hover:text-kh-text focus:outline-none focus-visible:ring-2 focus-visible:ring-kh-accent lg:hidden"
        >
          <Menu className="h-4 w-4" aria-hidden="true" />
        </button>
      ) : null}
      <span className="text-sm font-semibold text-kh-text">Knowledge Hub</span>
      <WorkspaceSelector workspaces={model.workspaces} workspaceId={model.workspace.id} />
      <span className="ml-auto truncate text-sm text-kh-text-muted">{model.identityName}</span>
    </header>
  );
}

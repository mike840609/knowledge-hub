import type { ReactNode } from "react";
import type { WorkspaceShellModel } from "@/server/knowledge-read";
import { Topbar } from "@/components/shell/topbar";
import { PrimaryNav } from "@/components/shell/primary-nav";

export function AppShell({ model, children }: { model: WorkspaceShellModel; children: ReactNode }) {
  return (
    <div className="flex h-screen flex-col bg-kh-bg-subtle text-kh-text">
      <Topbar model={model} />
      <div className="flex min-h-0 flex-1">
        <aside className="w-40 shrink-0 border-r border-kh-border bg-kh-bg">
          <PrimaryNav workspaceId={model.workspace.id} />
        </aside>
        <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}

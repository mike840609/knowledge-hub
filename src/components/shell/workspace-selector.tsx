"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CreateTeamDialog } from "@/components/workspaces/create-team-dialog";
import { useWorkspaceAuthorization } from "./use-workspace-authorization";

export function WorkspaceSelector({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const { navigation, confirmed, refresh } = useWorkspaceAuthorization();
  const [creating, setCreating] = useState(false);
  const menu = useRef<HTMLDetailsElement>(null);
  const current = navigation.items.find((item) => item.id === workspaceId);
  const choose = (id: string) => {
    if (menu.current) menu.current.open = false;
    router.push(`/w/${id}/knowledge`);
  };
  const item = (entry: (typeof navigation.items)[number]) => (
    <button key={entry.id} type="button" aria-current={entry.id === workspaceId ? "page" : undefined}
      className="block w-full truncate rounded px-3 py-2 text-left text-sm hover:bg-kh-bg-hover focus-visible:ring-2 focus-visible:ring-kh-accent"
      onClick={() => choose(entry.id)}>{entry.type === "PERSONAL" ? "My Space" : entry.name}</button>
  );
  return <>
    <details ref={menu} className="relative" onKeyDown={(event) => {
      if (event.key === "Escape" && menu.current) {
        menu.current.open = false;
        menu.current.querySelector("summary")?.focus();
      }
    }}>
      <summary aria-label={`Workspace: ${current?.type === "PERSONAL" ? "My Space" : current?.name ?? "Workspace"}`}
        className="max-w-56 cursor-pointer truncate rounded border border-kh-border px-2 py-1 text-sm focus-visible:ring-2 focus-visible:ring-kh-accent">
        {current?.type === "PERSONAL" ? "My Space" : current?.name ?? "Workspace"}
      </summary>
      <nav aria-label="Workspaces" className="absolute left-0 top-full z-50 mt-1 max-h-96 w-64 overflow-auto rounded-lg border border-kh-border bg-kh-bg p-2 shadow-lg">
        {navigation.items.filter((entry) => entry.type === "PERSONAL").map(item)}
        <p className="px-3 pt-3 text-xs font-semibold text-kh-text-muted">Teams</p>
        {navigation.items.filter((entry) => entry.type === "TEAM" && entry.lifecycleState === "ACTIVE").map(item)}
        <details open={current?.lifecycleState === "ARCHIVED" || undefined} className="mt-2">
          <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-kh-text-muted">Archived</summary>
          {navigation.items.filter((entry) => entry.type === "TEAM" && entry.lifecycleState === "ARCHIVED").map(item)}
        </details>
        {navigation.canCreateTeam && <button type="button" disabled={!confirmed} className="mt-2 w-full rounded border-t border-kh-border px-3 py-2 text-left text-sm text-kh-accent disabled:opacity-50"
          onClick={() => { if (menu.current) menu.current.open = false; setCreating(true); }}>Create team</button>}
      </nav>
    </details>
    <CreateTeamDialog open={creating} onOpenChange={setCreating} canCreateTeam={confirmed && navigation.canCreateTeam}
      onDenied={() => { void refresh(); }}
      onCreated={(id) => { void refresh(); router.push(`/w/${id}/knowledge`); }} />
  </>;
}

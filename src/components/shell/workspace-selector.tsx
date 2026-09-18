"use client";

import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (menu.current && event.target instanceof Node && !menu.current.contains(event.target)) {
        menu.current.open = false;
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, []);
  const currentName = current?.type === "PERSONAL" ? "My Space" : current?.name ?? "Workspace";
  const item = (entry: (typeof navigation.items)[number]) => (
    <button key={entry.id} type="button" aria-current={entry.id === workspaceId ? "page" : undefined}
      className={`flex min-h-10 w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-kh-bg-hover focus-visible:ring-2 focus-visible:ring-kh-focus ${entry.id === workspaceId ? "bg-kh-bg-selected font-medium" : ""}`}
      onClick={() => choose(entry.id)}>
        <span className="min-w-0 flex-1 truncate" title={entry.type === "PERSONAL" ? "My Space" : entry.name}>{entry.type === "PERSONAL" ? "My Space" : entry.name}</span>
        {entry.id === workspaceId && <Check className="h-4 w-4 shrink-0 text-kh-text" aria-hidden="true" />}
      </button>
  );
  return <>
    <details ref={menu} className="group relative min-w-0 w-full" onKeyDown={(event) => {
      if (event.key === "Escape" && menu.current) {
        menu.current.open = false;
        menu.current.querySelector("summary")?.focus();
      }
    }}>
      <summary aria-label={`Workspace: ${currentName}`} title={`Switch workspace: ${currentName}`}
        className="flex min-h-9 w-full cursor-pointer list-none items-center gap-2 rounded-md border border-kh-border px-3 text-sm hover:bg-kh-bg-hover focus-visible:ring-2 focus-visible:ring-kh-focus [&::-webkit-details-marker]:hidden">
        <span className="hidden shrink-0 text-xs text-kh-text-muted sm:inline">Workspace</span>
        <span className="min-w-0 flex-1 truncate font-medium">{currentName}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-kh-text-muted group-open:rotate-180" aria-hidden="true" />
      </summary>
      <nav aria-label="Workspaces" className="absolute left-0 top-full z-50 mt-2 max-h-[min(24rem,calc(100dvh-5rem))] w-64 max-w-[calc(100vw-5rem)] sm:w-full overflow-auto rounded-lg border border-kh-border bg-kh-bg p-2 shadow-lg">
        {navigation.items.filter((entry) => entry.type === "PERSONAL").map(item)}
        <p className="px-3 pt-3 text-xs font-semibold text-kh-text-muted">Teams</p>
        {navigation.items.filter((entry) => entry.type === "TEAM" && entry.lifecycleState === "ACTIVE").map(item)}
        <details open={current?.lifecycleState === "ARCHIVED" || undefined} className="mt-2">
          <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-kh-text-muted">Archived</summary>
          {navigation.items.filter((entry) => entry.type === "TEAM" && entry.lifecycleState === "ARCHIVED").map(item)}
        </details>
        {navigation.canCreateTeam && <button type="button" disabled={!confirmed} className="mt-2 w-full rounded border-t border-kh-border px-3 py-2 text-left text-sm text-kh-text disabled:opacity-50"
          onClick={() => { if (menu.current) menu.current.open = false; setCreating(true); }}>Create team</button>}
      </nav>
    </details>
    <CreateTeamDialog open={creating} onOpenChange={setCreating} canCreateTeam={confirmed && navigation.canCreateTeam}
      onDenied={() => { void refresh(); }}
      onCreated={(id) => { void refresh(); router.push(`/w/${id}/knowledge`); }} />
  </>;
}

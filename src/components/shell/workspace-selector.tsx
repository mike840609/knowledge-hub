"use client";

import { Check, ChevronDown } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { CreateTeamDialog } from "@/components/workspaces/create-team-dialog";
import {
  MenuContent,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuRoot,
  MenuSeparator,
  MenuSub,
  MenuSubTrigger,
  MenuTrigger,
} from "@/components/ui/menu";
import { useWorkspaceAuthorization } from "./use-workspace-authorization";

type NavigationItem = ReturnType<typeof useWorkspaceAuthorization>["navigation"]["items"][number];

function displayName(entry: NavigationItem): string {
  return entry.type === "PERSONAL" ? "My Space" : entry.name;
}

export function WorkspaceSelector({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const { navigation, confirmed, refresh } = useWorkspaceAuthorization();
  const [creating, setCreating] = useState(false);
  const current = navigation.items.find((item) => item.id === workspaceId);
  const currentName = current ? displayName(current) : "Workspace";

  // Dismissal, outside clicks, focus return and arrow-key movement all come
  // from the primitive; this used to hand-roll the first three and never
  // offered the fourth.
  const item = (entry: NavigationItem) => {
    const selected = entry.id === workspaceId;
    const name = displayName(entry);
    return (
      <MenuItem
        key={entry.id}
        onClick={() => router.push(`/w/${entry.id}/knowledge`)}
        className={selected ? "bg-kh-bg-selected font-medium text-kh-selected-text" : ""}
      >
        <span className="min-w-0 flex-1 truncate" title={name}>{name}</span>
        {selected && <Check className="h-4 w-4 shrink-0" aria-hidden="true" />}
      </MenuItem>
    );
  };

  const personal = navigation.items.filter((entry) => entry.type === "PERSONAL");
  const teams = navigation.items.filter((entry) => entry.type === "TEAM" && entry.lifecycleState === "ACTIVE");
  const archived = navigation.items.filter((entry) => entry.type === "TEAM" && entry.lifecycleState === "ARCHIVED");

  return (
    <>
      <MenuRoot>
        <MenuTrigger
          aria-label={`Workspace: ${currentName}`}
          title={`Switch workspace: ${currentName}`}
          className="kh-focus-ring flex min-h-8 w-full min-w-0 items-center gap-2 rounded-md px-3 text-body transition-colors hover:bg-kh-bg-hover data-[popup-open]:bg-kh-bg-hover"
        >
          <span className="hidden shrink-0 text-caption text-kh-text-muted sm:inline">Workspace</span>
          <span className="min-w-0 flex-1 truncate text-left font-medium">{currentName}</span>
          <ChevronDown className="h-4 w-4 shrink-0 text-kh-text-muted" aria-hidden="true" />
        </MenuTrigger>
        <MenuContent className="max-h-[min(24rem,calc(100dvh-5rem))] w-64 max-w-[calc(100vw-5rem)] overflow-auto">
          {personal.map(item)}
          <MenuGroup>
            <MenuGroupLabel>Teams</MenuGroupLabel>
            {teams.map(item)}
          </MenuGroup>
          {/* Always present, even when empty: a reader looking for an archived
              team needs to see that the section exists and is simply empty. */}
          <MenuSub>
            <MenuSubTrigger>Archived</MenuSubTrigger>
            <MenuContent className="w-56">
              {archived.length > 0
                ? archived.map(item)
                : <MenuItem disabled>No archived teams</MenuItem>}
            </MenuContent>
          </MenuSub>
          {navigation.canCreateTeam && (
            <>
              <MenuSeparator />
              <MenuItem disabled={!confirmed} onClick={() => setCreating(true)}>
                Create team
              </MenuItem>
            </>
          )}
        </MenuContent>
      </MenuRoot>
      <CreateTeamDialog
        open={creating}
        onOpenChange={setCreating}
        canCreateTeam={confirmed && navigation.canCreateTeam}
        onDenied={() => { void refresh(); }}
        onCreated={(id) => { void refresh(); router.push(`/w/${id}/knowledge`); }}
      />
    </>
  );
}

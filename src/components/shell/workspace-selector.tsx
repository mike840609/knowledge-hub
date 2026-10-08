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
import { Tooltip } from "@/components/ui/tooltip";
import { useWorkspaceAuthorization } from "./use-workspace-authorization";

type NavigationItem = ReturnType<typeof useWorkspaceAuthorization>["navigation"]["items"][number];

function displayName(entry: NavigationItem): string {
  return entry.type === "PERSONAL" ? "My Space" : entry.name;
}

// It heads the primary rail (and the Menu drawer), above the navigation it scopes. Collapsed, the rail
// is 48px and the switcher is the name's first letter, with the name in a tooltip.
export function WorkspaceSelector({ workspaceId, compact = false }: { workspaceId: string; compact?: boolean }) {
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
  // Team workspaces are announced and not yet open. While they are not, the switcher says so where they
  // will be — one disabled row — and takes nobody to one: not by their names, not by "Archived", and not
  // by creating one. Server authorization also closes direct links while Team is unavailable.
  const teamsOpen = navigation.teamsOpen;
  return (
    <>
      <MenuRoot>
        {compact ? (
          <Tooltip label={currentName} side="right">
            <MenuTrigger
              aria-label={`Workspace: ${currentName}`}
              className="kh-control kh-focus-ring flex h-8 w-full items-center justify-center rounded-md transition-colors hover:bg-kh-bg-hover data-[popup-open]:bg-kh-bg-hover"
            >
              <span aria-hidden="true" className="flex h-6 w-6 items-center justify-center rounded-sm bg-kh-bg-selected text-caption font-semibold text-kh-selected-text">
                {currentName.charAt(0).toUpperCase()}
              </span>
            </MenuTrigger>
          </Tooltip>
        ) : (
          <MenuTrigger
            aria-label={`Workspace: ${currentName}`}
            className="kh-control kh-focus-ring flex min-h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-body transition-colors hover:bg-kh-bg-hover data-[popup-open]:bg-kh-bg-hover"
          >
            <span className="min-w-0 flex-1 truncate text-left font-medium text-kh-text" title={currentName}>{currentName}</span>
            <ChevronDown className="h-4 w-4 shrink-0 text-kh-text-muted" aria-hidden="true" />
          </MenuTrigger>
        )}
        <MenuContent className="max-h-[min(24rem,calc(100dvh-5rem))] w-64 max-w-[calc(100vw-5rem)] overflow-auto">
          {personal.map(item)}
          <MenuGroup>
            <MenuGroupLabel>Teams</MenuGroupLabel>
            {teamsOpen ? teams.map(item) : (
              <MenuItem disabled>
                <span className="min-w-0 flex-1 truncate">Team workspaces</span>
                <span className="shrink-0 text-caption text-kh-text-muted">Coming soon</span>
              </MenuItem>
            )}
          </MenuGroup>
          {/* Always present, even when empty: a reader looking for an archived
              team needs to see that the section exists and is simply empty. */}
          {teamsOpen && (
            <MenuSub>
              <MenuSubTrigger>Archived</MenuSubTrigger>
              <MenuContent className="w-56">
                {archived.length > 0
                  ? archived.map(item)
                  : <MenuItem disabled>No archived teams</MenuItem>}
              </MenuContent>
            </MenuSub>
          )}
          {teamsOpen && navigation.canCreateTeam && (
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

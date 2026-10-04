"use client";

import { useWorkspaceAuthorization } from "./use-workspace-authorization";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Tooltip } from "@/components/ui/tooltip";
import { BookOpenText, Database, Network, Settings, Home, UserRound } from "lucide-react";

export function PrimaryNav({
  workspaceId,
  onNavigate,
  compact = false,
}: {
  workspaceId: string;
  onNavigate?: () => void;
  compact?: boolean;
}) {
  const { access } = useWorkspaceAuthorization();
  const pathname = usePathname();
  const items = [
    ...(access.workspace.type === "PERSONAL" ? [{ name: "Home", href: `/w/${workspaceId}/home`, Icon: Home }] : []),
    {
      name: "Knowledge",
      href: `/w/${workspaceId}/knowledge`,
      Icon: BookOpenText,
    },
    {
      name: "Graph",
      href: `/w/${workspaceId}/graph`,
      Icon: Network,
    },
    ...(access.actions.canInspectSources ? [{
      name: "Sources",
      href: `/w/${workspaceId}/sources`,
      Icon: Database,
    }] : []),
    ...(access.workspace.type === "PERSONAL" ? [{name: "Insights", href: `/w/${workspaceId}/profile`, Icon: UserRound}] : []),
    ...(access.actions.canOpenSettings ? [{name: "Settings", href: `/w/${workspaceId}/settings`, Icon: Settings}] : []),
  ];
  return (
    <nav aria-label="Primary" className="flex flex-col gap-0.5 p-2">
      {items.map(({ name, href, Icon }) => {
        const selected = pathname === href || pathname.startsWith(`${href}/`);
        const link = (
          <Link
            key={name}
            href={href}
            onClick={onNavigate}
            aria-current={selected ? "page" : undefined}
            aria-label={compact ? name : undefined}
            className={`kh-control flex h-8 items-center rounded-md px-2 text-body transition kh-focus-ring ${compact ? "justify-center" : "gap-2"} ${selected ? "bg-kh-bg-selected font-medium text-kh-selected-text hover:bg-kh-bg-selected" : "text-kh-text-muted hover:bg-kh-bg-hover hover:text-kh-text"}`}
          >
            <Icon size={15} aria-hidden="true" />
            {compact ? null : <span>{name}</span>}
          </Link>
        );
        return compact ? <Tooltip key={name} label={name} side="right">{link}</Tooltip> : link;
      })}
    </nav>
  );
}

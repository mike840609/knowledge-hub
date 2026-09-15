"use client";

import { useWorkspaceAuthorization } from "./use-workspace-authorization";
import Link from "next/link";
import { BookOpenText, Database, Settings } from "lucide-react";

export function PrimaryNav({
  workspaceId,
  onNavigate,
}: {
  workspaceId: string;
  onNavigate?: () => void;
}) {
  const { access } = useWorkspaceAuthorization();
  const items = [
    {
      name: "Knowledge",
      href: `/w/${workspaceId}/knowledge`,
      Icon: BookOpenText,
    },
    ...(access.actions.canInspectSources ? [{
      name: "Sources",
      href: `/w/${workspaceId}/sources`,
      Icon: Database,
    }] : []),
    ...(access.actions.canOpenSettings ? [{name: "Settings", href: `/w/${workspaceId}/settings`, Icon: Settings}] : []),
  ];
  return (
    <nav aria-label="Primary" className="flex flex-col gap-0.5 p-2">
      {items.map(({ name, href, Icon }) => (
        <Link
          key={name}
          href={href}
          onClick={onNavigate}
          className="flex items-center gap-2 rounded px-2 py-1.5 text-sm text-kh-text-muted transition hover:bg-kh-bg-hover hover:text-kh-text focus:outline-none focus-visible:ring-2 focus-visible:ring-kh-accent"
        >
          <Icon size={15} strokeWidth={2} aria-hidden="true" />
          <span>{name}</span>
        </Link>
      ))}
    </nav>
  );
}

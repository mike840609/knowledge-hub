"use client";

import { useWorkspaceAuthorization } from "./use-workspace-authorization";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpenText, Database, Settings } from "lucide-react";

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
      {items.map(({ name, href, Icon }) => {
        const selected = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={name}
            href={href}
            onClick={onNavigate}
            aria-current={selected ? "page" : undefined}
            aria-label={compact ? name : undefined}
            title={compact ? name : undefined}
            className={`flex h-9 items-center rounded px-2 text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-kh-focus ${compact ? "justify-center" : "gap-2"} ${selected ? "bg-kh-bg-selected font-medium text-kh-selected-text hover:bg-kh-bg-selected" : "text-kh-text-muted hover:bg-kh-bg-hover hover:text-kh-text"}`}
          >
            <Icon size={15} strokeWidth={2} aria-hidden="true" />
            {compact ? null : <span>{name}</span>}
          </Link>
        );
      })}
    </nav>
  );
}

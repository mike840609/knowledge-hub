"use client";

import { useWorkspaceAuthorization } from "./use-workspace-authorization";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Tooltip } from "@/components/ui/tooltip";
import { BarChart3, BookOpenText, Database, Inbox, Network, Settings, Home, Share2, type LucideIcon } from "lucide-react";
import { useInboxUnread } from "./use-inbox-unread";

type NavItem = { name: string; href: string; Icon: LucideIcon; badge?: number; label?: string };

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
  const personal = access.workspace.type === "PERSONAL";
  const unread = useInboxUnread(personal);
  const inboxLabel = unread > 0 ? `Inbox, ${unread} unread` : "Inbox";
  const items: NavItem[] = [
    ...(personal ? [{ name: "Inbox", href: `/w/${workspaceId}/inbox`, Icon: Inbox, badge: unread, label: inboxLabel }] : []),
    ...(personal ? [{ name: "Home", href: `/w/${workspaceId}/home`, Icon: Home }] : []),
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
    ...(personal && access.actions.canSearch ? [{ name: "Shares", href: `/w/${workspaceId}/shares`, Icon: Share2 }] : []),
    ...(personal ? [{name: "Insights", href: `/w/${workspaceId}/profile`, Icon: BarChart3}] : []),
    ...(access.actions.canOpenSettings ? [{name: "Settings", href: `/w/${workspaceId}/settings`, Icon: Settings}] : []),
  ];
  // The current place is a neutral step above hover, not the accent: the accent marks what is selected in the
  // content (the explorer's document, a menu's row), and two accent blocks side by side competed for the eye.
  return (
    <nav aria-label="Primary" className="flex flex-col gap-0.5 p-2">
      {items.map(({ name, href, Icon, badge, label }) => {
        const selected = pathname === href || pathname.startsWith(`${href}/`);
        const link = (
          <Link
            key={name}
            href={href}
            onClick={onNavigate}
            aria-current={selected ? "page" : undefined}
            aria-label={compact ? label ?? name : undefined}
            className={`kh-control flex kh-rail-row items-center rounded-md px-2 kh-rail-text transition kh-focus-ring ${compact ? "relative justify-center" : "gap-2"} ${selected ? "bg-kh-bg-hover font-medium text-kh-text hover:bg-kh-bg-hover" : "text-kh-text-muted hover:bg-kh-bg-hover hover:text-kh-text"}`}
          >
            <Icon size={15} aria-hidden="true" />
            {compact ? null : <span className="min-w-0 flex-1 truncate">{name}</span>}
            {badge ? (
              <span
                className={compact
                  ? "absolute right-1 top-0.5 inline-flex min-w-4 items-center justify-center rounded-full bg-kh-primary px-1 text-micro font-semibold leading-4 text-kh-on-primary tabular-nums"
                  : "inline-flex min-w-4 shrink-0 items-center justify-center rounded-full bg-kh-bg-selected px-1.5 text-caption font-semibold leading-5 text-kh-selected-text tabular-nums"}
                aria-hidden="true"
              >
                {badge > 99 ? "99+" : badge}
              </span>
            ) : null}
          </Link>
        );
        return compact ? <Tooltip key={name} label={label ?? name} side="right">{link}</Tooltip> : link;
      })}
    </nav>
  );
}

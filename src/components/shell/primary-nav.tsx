"use client";

import { useWorkspaceAuthorization } from "./use-workspace-authorization";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { buttonClasses } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { BarChart3, Inbox, Settings, Home, type LucideIcon } from "lucide-react";
import { knowledgeDestinations, PageSwitch } from "./knowledge-destinations";

type NavItem = { name: string; href: string; Icon: LucideIcon; badge?: number; label?: string; compactOnly?: boolean };

function inboxItem(workspaceId: string, unread: number): NavItem {
  return { name: "Inbox", href: `/w/${workspaceId}/inbox`, Icon: Inbox, badge: unread, label: unread > 0 ? `Inbox, ${unread} unread` : "Inbox" };
}

function NavigationLink({ item, pathname, appearance }: { item: NavItem; pathname: string; appearance: "row" | "rail" | "header" }) {
  const { name, href, Icon, badge, label = name } = item;
  const selected = pathname === href || pathname.startsWith(`${href}/`);
  const header = appearance === "header";
  const iconOnly = appearance !== "row";
  const stateClasses = selected ? "bg-kh-bg-hover font-medium text-kh-text hover:bg-kh-bg-hover" : "text-kh-text-muted hover:bg-kh-bg-hover hover:text-kh-text";
  const classes = header
    ? buttonClasses({
      variant: "ghost", icon: true,
      className: "relative aria-[current=page]:border-kh-border-strong aria-[current=page]:bg-kh-bg-hover aria-[current=page]:text-kh-text [@media(pointer:coarse)]:size-11",
    })
    : `kh-control flex kh-rail-row items-center rounded-md px-2 kh-rail-text transition kh-focus-ring ${iconOnly ? "relative justify-center" : "gap-2"} ${stateClasses}`;
  const link = (
    <Link href={href} aria-current={selected ? (pathname === href ? "page" : "location") : undefined} aria-label={label} data-compact-destination={item.compactOnly || undefined} className={classes}>
      <Icon size={15} aria-hidden="true" />
      {iconOnly ? null : <span className="min-w-0 flex-1 truncate">{name}</span>}
      {badge ? (
        <span
          className={iconOnly
            ? `absolute ${header ? "-right-0.5 -top-0.5" : "right-1 top-0.5"} inline-flex min-w-4 items-center justify-center rounded-full bg-kh-primary px-1 text-micro font-semibold leading-4 text-kh-on-primary tabular-nums`
            : "inline-flex min-w-4 shrink-0 items-center justify-center rounded-full bg-kh-bg-selected px-1.5 text-caption font-semibold leading-5 text-kh-selected-text tabular-nums"}
          aria-hidden="true"
        >
          {badge > 99 ? "99+" : badge}
        </span>
      ) : null}
    </Link>
  );
  return iconOnly ? <Tooltip label={label} side={header ? "bottom" : "right"}>{link}</Tooltip> : link;
}

export function InboxHeaderLink({ workspaceId, unread }: { workspaceId: string; unread: number }) {
  const pathname = usePathname();
  return <NavigationLink item={inboxItem(workspaceId, unread)} pathname={pathname} appearance="header" />;
}

export function PrimaryNav({
  workspaceId,
  compact = false,
  inboxUnread,
}: {
  workspaceId: string;
  compact?: boolean;
  inboxUnread?: number;
}) {
  const { access } = useWorkspaceAuthorization();
  const pathname = usePathname();
  const personal = access.workspace.type === "PERSONAL";
  const home: NavItem[] = personal ? [{ name: "Home", href: `/w/${workspaceId}/home`, Icon: Home }] : [];
  if (!compact) {
    // Expanded: Inbox (the drawer's row; the desktop header owns it otherwise), then the page switch.
    return (
      <nav aria-label="Primary" className="flex flex-col gap-1 p-2">
        {personal && inboxUnread !== undefined ? <NavigationLink item={inboxItem(workspaceId, inboxUnread)} pathname={pathname} appearance="row" /> : null}
        <PageSwitch items={[...home, ...knowledgeDestinations(workspaceId, access)]} pathname={pathname} />
      </nav>
    );
  }
  const items: NavItem[] = [
    ...(personal && inboxUnread !== undefined ? [inboxItem(workspaceId, inboxUnread)] : []),
    ...home,
    ...knowledgeDestinations(workspaceId, access).map((item) => ({ ...item, compactOnly: true })),
    ...(personal ? [
      { name: "Insights", href: `/w/${workspaceId}/profile`, Icon: BarChart3, compactOnly: true },
    ] : []),
    ...(access.actions.canOpenSettings ? [{ name: "Settings", href: `/w/${workspaceId}/settings`, Icon: Settings, compactOnly: true }] : []),
  ];
  // The current place is a neutral step above hover, not the accent: the accent marks what is selected in the
  // content (the explorer's document, a menu's row), and two accent blocks side by side competed for the eye.
  return (
    <nav aria-label="Primary" className="flex flex-col gap-0.5 p-2">
      {items.map((item) => (
        <NavigationLink key={item.name} item={item} pathname={pathname} appearance="rail" />
      ))}
    </nav>
  );
}

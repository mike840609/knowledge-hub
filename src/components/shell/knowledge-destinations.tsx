"use client";

import { Database, Network, Share2, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { Tooltip } from "@/components/ui/tooltip";
import type { WorkspaceAccessView } from "@/server/workspace-admin";

export type Destination = {
  name: string;
  href: string;
  Icon: LucideIcon;
};

export function knowledgeDestinations(workspaceId: string, access: WorkspaceAccessView): readonly Destination[] {
  const prefix = `/w/${workspaceId}`;
  return [
    { name: "Graph", href: `${prefix}/graph`, Icon: Network },
    ...(access.actions.canInspectSources ? [{ name: "Sources", href: `${prefix}/sources`, Icon: Database }] : []),
    ...(access.workspace.type === "PERSONAL" && access.actions.canSearch
      ? [{ name: "Shares", href: `${prefix}/shares`, Icon: Share2 }] : []),
  ];
}

function currentness(pathname: string, href: string): "page" | "location" | undefined {
  if (pathname === href) return "page";
  return pathname.startsWith(`${href}/`) ? "location" : undefined;
}

/**
 * The expanded sidebar's page switch: Home, Graph, Sources and Shares in one track under Search. The page the
 * reader is on is a raised item with its icon and name; the others are icons, named by tooltip and accessible
 * name. They are links, so on a page that is none of them (a document, Inbox, Settings) nothing is raised
 * (2026-11-23-knowledge-destination-icons-design.md).
 */
export function PageSwitch({ items, pathname }: { items: readonly Destination[]; pathname: string }) {
  return (
    <div className="flex min-w-0 items-center gap-0.5 rounded-lg bg-kh-switch-track p-0.5">
      {items.map(({ name, href, Icon }) => {
        const current = currentness(pathname, href);
        const link = (
          <Link
            key={href}
            href={href}
            aria-label={name}
            aria-current={current}
            className={`kh-control kh-focus-ring flex h-7 min-w-0 items-center justify-center gap-1.5 rounded-md text-body-sm font-medium transition-colors ${
              current ? "shrink-0 bg-kh-switch-thumb px-3 text-kh-text" : "flex-1 text-kh-text-muted hover:text-kh-text"
            }`}
          >
            <Icon size={15} className="shrink-0" aria-hidden="true" />
            {current ? <span className="truncate">{name}</span> : null}
          </Link>
        );
        return current ? link : <Tooltip key={href} label={name}>{link}</Tooltip>;
      })}
    </div>
  );
}

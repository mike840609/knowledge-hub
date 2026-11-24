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
        // One element per item whatever the page: the thumb and label animate in place instead of remounting.
        return (
          <Tooltip key={href} label={name}>
            <Link
              href={href}
              aria-label={name}
              aria-current={current}
              style={{ flexGrow: current ? 3 : 1 }}
              className={`kh-control kh-focus-ring flex h-7 min-w-0 basis-0 items-center justify-center rounded-md px-2 text-body-sm font-medium transition-[flex-grow,background-color,color] duration-160 ease-out ${
                current ? "bg-kh-switch-thumb text-kh-text" : "text-kh-text-muted hover:text-kh-text"
              }`}
            >
              <Icon size={15} className="shrink-0" aria-hidden="true" />
              <span
                aria-hidden="true"
                style={{ gridTemplateColumns: current ? "1fr" : "0fr", marginLeft: current ? 6 : 0, opacity: current ? 1 : 0 }}
                className="grid min-w-0 transition-[grid-template-columns,margin-left,opacity] duration-160 ease-out"
              >
                <span className="truncate">{name}</span>
              </span>
            </Link>
          </Tooltip>
        );
      })}
    </div>
  );
}

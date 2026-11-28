"use client";

import { Bot, Database, Network, Share2, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useState, type MouseEvent } from "react";
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
      ? [{ name: "Shares", href: `${prefix}/shares`, Icon: Share2 }, { name: "Agents", href: `${prefix}/agents`, Icon: Bot }] : []),
  ];
}

function currentness(pathname: string, href: string): "page" | "location" | undefined {
  if (pathname === href) return "page";
  return pathname.startsWith(`${href}/`) ? "location" : undefined;
}

/**
 * The expanded sidebar's page switch: Home, Graph, Sources, Shares and Agents in one track under Search. The page the
 * reader is on is a raised item with its icon and name; the others are icons, named by tooltip and accessible
 * name. They are links, so on a page that is none of them (a document, Inbox, Settings) nothing is raised
 * (2026-11-23-knowledge-destination-icons-design.md).
 */
export function PageSwitch({ items, pathname }: { items: readonly Destination[]; pathname: string }) {
  // The raised item moves on click, not when the route commits: a dynamic page can take a server round trip,
  // and until then the switch would sit still. aria-current stays on the real page. The raise is dropped as
  // soon as the route changes (so Back to the page it left does not bring it back), and a click on the page
  // already showing takes it back there.
  // ponytail: a navigation that fails without changing the route leaves the raise until the next route change.
  const [pending, setPending] = useState<{ href: string; from: string } | null>(null);
  if (pending && pending.from !== pathname) setPending(null);
  const target = pending?.from === pathname ? pending.href : null;
  const choose = (href: string) => (event: MouseEvent) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    setPending(href === pathname ? null : { href, from: pathname });
  };
  return (
    <div className="flex min-w-0 items-center gap-0.5 rounded-lg bg-kh-switch-track p-0.5">
      {items.map(({ name, href, Icon }) => {
        const current = currentness(pathname, href);
        const raised = target ? href === target : Boolean(current);
        // One element per item whatever the page: the thumb and label animate in place instead of remounting.
        return (
          <Tooltip key={href} label={name}>
            <Link
              href={href}
              aria-label={name}
              aria-current={current}
              onClick={choose(href)}
              style={{ flexGrow: raised ? 3 : 1 }}
              className={`kh-control kh-focus-ring flex h-7 min-w-0 basis-0 items-center justify-center rounded-md px-1.5 text-body-sm font-medium transition-[flex-grow,background-color,color] duration-160 ease-out ${
                raised ? "bg-kh-switch-thumb text-kh-text" : "text-kh-text-muted hover:text-kh-text"
              }`}
            >
              <Icon size={15} className="shrink-0" aria-hidden="true" />
              <span
                aria-hidden="true"
                style={{ gridTemplateColumns: raised ? "1fr" : "0fr", marginLeft: raised ? 6 : 0, opacity: raised ? 1 : 0 }}
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

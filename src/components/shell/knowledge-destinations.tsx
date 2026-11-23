"use client";

import { Database, Network, Share2, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { buttonClasses } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import type { WorkspaceAccessView } from "@/server/workspace-admin";
import { useWorkspaceAuthorization } from "./use-workspace-authorization";

type Destination = {
  name: "Graph" | "Sources" | "Shares";
  href: string;
  Icon: LucideIcon;
};

export function knowledgeDestinations(workspaceId: string, access: WorkspaceAccessView): readonly Destination[] {
  const prefix = `/w/${workspaceId}`;
  return [
    { name: "Graph", href: `${prefix}/graph`, Icon: Network },
    ...(access.actions.canInspectSources ? [{ name: "Sources" as const, href: `${prefix}/sources`, Icon: Database }] : []),
    ...(access.workspace.type === "PERSONAL" && access.actions.canSearch
      ? [{ name: "Shares" as const, href: `${prefix}/shares`, Icon: Share2 }] : []),
  ];
}

/**
 * Graph, Sources and Shares as a row of icons in the Knowledge header. The one the reader is on also
 * shows its name; the others name themselves by tooltip and accessible name. They are always on screen,
 * where a disclosure hid them (2026-11-23-knowledge-destination-icons-design.md).
 */
export function KnowledgeDestinations({ workspaceId }: { workspaceId: string }) {
  const pathname = usePathname();
  const { access } = useWorkspaceAuthorization();
  return (
    <nav aria-label="Knowledge destinations" className="min-w-0 flex-1">
      <ul className="flex min-w-0 items-center gap-0.5">
        {knowledgeDestinations(workspaceId, access).map(({ name, href, Icon }) => {
          const current = pathname === href ? "page" : pathname.startsWith(`${href}/`) ? "location" : undefined;
          const link = (
            <Link
              href={href}
              aria-label={name}
              aria-current={current}
              className={buttonClasses({
                variant: "ghost",
                icon: !current,
                size: current ? "sm" : "md",
                className: current ? "min-w-0 bg-kh-bg-hover text-kh-text hover:bg-kh-bg-hover" : "text-kh-text-muted hover:text-kh-text",
              })}
            >
              <Icon size={15} className="shrink-0" aria-hidden="true" />
              {current ? <span className="truncate">{name}</span> : null}
            </Link>
          );
          return <li key={href} className="min-w-0">{current ? link : <Tooltip label={name}>{link}</Tooltip>}</li>;
        })}
      </ul>
    </nav>
  );
}

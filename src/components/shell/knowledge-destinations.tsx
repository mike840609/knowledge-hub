"use client";

import { Popover } from "@base-ui-components/react/popover";
import { Check, ChevronDown, Database, Network, Share2, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { menuPopupClasses } from "@/components/ui/menu";
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

export function KnowledgeDestinations({ workspaceId }: { workspaceId: string }) {
  const pathname = usePathname();
  const { access } = useWorkspaceAuthorization();
  const [openOn, setOpenOn] = useState<string | null>(null);
  const destinations = knowledgeDestinations(workspaceId, access);
  const current = destinations.find(({ href }) => pathname === href || pathname.startsWith(`${href}/`));
  const label = current ? `Knowledge / ${current.name}` : "Knowledge";

  return (
    <Popover.Root open={openOn === pathname} onOpenChange={(open) => setOpenOn(open ? pathname : null)}>
      <h2 className="min-w-0 flex-1">
        <Popover.Trigger title={label} className="kh-control kh-rail-row kh-focus-ring flex max-w-full items-center gap-0.5 rounded-md px-0.5 text-left text-caption font-medium text-kh-text-muted hover:bg-kh-bg-hover hover:text-kh-text data-[popup-open]:bg-kh-bg-hover data-[popup-open]:text-kh-text">
          <span className="leading-none">Knowledge{current && <> <span className="inline-block whitespace-nowrap">/ {current.name}</span></>}</span>
          <ChevronDown size={13} className="shrink-0" aria-hidden="true" />
        </Popover.Trigger>
      </h2>
      <Popover.Portal>
        <Popover.Positioner align="start" sideOffset={4} className="z-50">
          <Popover.Popup
            aria-label="Knowledge destinations"
            initialFocus={false}
            className={`${menuPopupClasses} w-52 max-w-[var(--available-width)] max-h-[var(--available-height)] overflow-auto motion-reduce:transition-none`}
          >
            <nav aria-label="Knowledge destinations">
              <ul>
                {destinations.map(({ name, href, Icon }) => (
                  <li key={href}>
                    <Link
                      href={href}
                      onNavigate={() => setOpenOn(null)}
                      aria-current={current?.href === href ? (pathname === href ? "page" : "location") : undefined}
                      className="kh-control kh-focus-ring flex min-h-8 items-center gap-2 rounded-md px-2 text-body text-kh-text hover:bg-kh-bg-hover aria-[current=page]:bg-kh-bg-hover aria-[current=location]:bg-kh-bg-hover"
                    >
                      <Icon size={15} className="shrink-0 text-kh-text-muted" aria-hidden="true" />
                      <span className="flex-1">{name}</span>
                      {current?.href === href && <Check size={14} className="shrink-0" aria-hidden="true" />}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

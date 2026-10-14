"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWorkspaceAuthorization } from "./use-workspace-authorization";
import { primaryNavItems, type NavGroup } from "./primary-nav-items";

export function PrimaryNav({ workspaceId, group, onNavigate }: { workspaceId: string; group: NavGroup; onNavigate?: () => void }) {
  const { access } = useWorkspaceAuthorization();
  const pathname = usePathname();
  const items = primaryNavItems(workspaceId, access, group);
  if (items.length === 0) return null;
  // The current place is a neutral step above hover, not the accent: the accent marks what is selected in the
  // content (the tree's document, a menu's row), and two accent blocks side by side competed for the eye.
  return (
    <nav aria-label={group === "top" ? "Primary" : "Workspace"} className="flex flex-col gap-0.5">
      {items.map(({ name, href, Icon }) => {
        const selected = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={name}
            href={href}
            onClick={onNavigate}
            aria-current={selected ? "page" : undefined}
            className={`kh-control flex h-8 items-center gap-2 rounded-md px-2 text-body transition kh-focus-ring ${selected ? "bg-kh-bg-hover font-medium text-kh-text hover:bg-kh-bg-hover" : "text-kh-text-muted hover:bg-kh-bg-hover hover:text-kh-text"}`}
          >
            <Icon size={15} aria-hidden="true" />
            <span>{name}</span>
          </Link>
        );
      })}
    </nav>
  );
}

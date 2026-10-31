"use client";

import Link, { useLinkStatus } from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { tabClasses, tabListClasses } from "@/components/ui/tab";

export type SharesTab = "mine" | "saved" | "discussions";

export function parseSharesTab(tab: string | null): SharesTab {
  return tab === "saved" || tab === "discussions" ? tab : "mine";
}

/**
 * The Shares tab bar. It derives the current tab from `?tab=` so the route shell
 * can render it once, marks the clicked tab before the server answers, and warms
 * the two sibling pages so a switch is a content swap rather than a wait.
 */
export function SharesNavigation({ workspaceId, discussionsUnread = 0 }: { workspaceId: string; discussionsUnread?: number }) {
  const params = useSearchParams();
  const derived = parseSharesTab(params.get("tab"));
  const [active, setActive] = useState<SharesTab>(derived);
  useEffect(() => setActive(derived), [derived]);

  const sections = [
    { id: "mine", label: "My shares", href: `/w/${workspaceId}/shares` },
    { id: "saved", label: "Saved shares", href: `/w/${workspaceId}/shares?tab=saved` },
    { id: "discussions", label: "Discussions", href: `/w/${workspaceId}/shares?tab=discussions` },
  ] as const;

  return (
    <nav aria-label="Shares sections" className={tabListClasses}>
      {sections.map(section => (
        <Link
          key={section.id}
          href={section.href}
          prefetch={active === section.id ? false : true}
          aria-current={active === section.id ? "page" : undefined}
          className={tabClasses(active === section.id)}
          onClick={event => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
            setActive(section.id);
          }}
        >
          <TabLabel>
            {section.label}
            {section.id === "discussions" && discussionsUnread > 0 && (
              <span aria-label={`${discussionsUnread} unread`} className="ml-1 tabular-nums text-caption text-kh-text-muted">{discussionsUnread}</span>
            )}
          </TabLabel>
        </Link>
      ))}
    </nav>
  );
}

/** Dims the label while the link's navigation is in flight, so an unprefetched click still answers. */
function TabLabel({ children }: { children: React.ReactNode }) {
  const { pending } = useLinkStatus();
  return <span className={pending ? "opacity-60" : undefined}>{children}</span>;
}

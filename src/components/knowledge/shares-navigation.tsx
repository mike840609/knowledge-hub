"use client";

import Link, { useLinkStatus } from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { tabClasses, tabListClasses } from "@/components/ui/tab";
import { cancelPendingLiveSearch } from "@/components/search/live-search-submit";

export type SharesTab = "mine" | "saved" | "discussions";

export function parseSharesTab(tab: string | null): SharesTab {
  return tab === "saved" || tab === "discussions" ? tab : "mine";
}

/**
 * The Shares tab bar. It derives the current tab from `?tab=` so the route shell
 * can render it once, marks the clicked tab before the server answers, and warms
 * the two sibling pages so a switch is a content swap rather than a wait.
 */
export function SharesNavigation({ workspaceId, discussionsBadge }: { workspaceId: string; discussionsBadge?: React.ReactNode }) {
  const params = useSearchParams();
  const router = useRouter();
  const derived = parseSharesTab(params.get("tab"));
  const [optimistic, setOptimistic] = useState<{ from: SharesTab; to: SharesTab } | null>(null);
  // Keep the last click active even if an older navigation updates the URL first.
  const active = optimistic?.to ?? derived;
  useEffect(() => {
    if (optimistic && derived === optimistic.to) setOptimistic(null);
  }, [derived, optimistic]);
  // Inbox can mark all followed discussions read without leaving this route.
  // Refresh the server-projected badge (and list) when notifications change.
  useEffect(() => {
    const refresh = () => router.refresh();
    window.addEventListener("kh:notification-changed", refresh);
    return () => window.removeEventListener("kh:notification-changed", refresh);
  }, [router]);

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
            if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
            // The tab bar is outside the active filter form. Cancel a queued
            // search before it can router.replace() the destination tab away.
            const activeForm = event.currentTarget.closest(".kh-page-wide")
              ?.querySelector<HTMLFormElement>('form[data-live-search-ready="true"]') ?? null;
            cancelPendingLiveSearch(activeForm);
            setOptimistic({ from: derived, to: section.id });
          }}
        >
          <TabLabel onSettled={() => setOptimistic(current => current?.to === section.id ? null : current)}>
            {section.label}
            {section.id === "discussions" && discussionsBadge}
          </TabLabel>
        </Link>
      ))}
    </nav>
  );
}

/** Dims the label while the link's navigation is in flight, and reports the settle so a failed navigation can drop the optimistic tab. */
function TabLabel({ children, onSettled }: { children: React.ReactNode; onSettled?: () => void }) {
  const { pending } = useLinkStatus();
  const settled = useRef(onSettled);
  settled.current = onSettled;
  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !pending) settled.current?.();
    wasPending.current = pending;
  }, [pending]);
  return <span className={pending ? "opacity-60" : undefined}>{children}</span>;
}

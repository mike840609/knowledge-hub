"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { tabClasses, tabListClasses } from "@/components/ui/tab";

export type NavTab = { href: string; label: string };

/**
 * A tab bar whose tabs are links, for navigation between sibling routes.
 *
 * `aria-current="page"` rather than `role="tab"`: these are links that change
 * the URL, not tabs that swap a panel, and claiming the tab role would
 * promise arrow-key movement between panels that does not exist here. The
 * look comes from `ui/tab`, so it matches the real tabs in the Inspector.
 *
 * The current tab is matched exactly. Every tab here owns one path, so a
 * prefix match would light up `General` (which sits at the section root) on
 * every page in the section.
 */
export function NavTabs({ label, tabs }: { label: string; tabs: readonly NavTab[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label={label} className={tabListClasses}>
      {tabs.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={tabClasses(active)}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

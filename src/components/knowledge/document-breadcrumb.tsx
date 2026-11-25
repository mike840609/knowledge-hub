"use client";

import Link from "next/link";
import { Fragment } from "react";
import { ChevronRight, Ellipsis } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";
import { MenuContent, MenuItem, MenuRoot, MenuTrigger } from "@/components/ui/menu";

export type DocumentBreadcrumbSegment = {
  label: string;
  href?: string;
};

/**
 * The reader's `location › title` line; the composer draws the same one.
 *
 * Where the page is narrow (the document pane under 40rem, `.kh-crumb-*` in globals.css) the segments between the
 * first and the page itself fold into one `…` control that opens them as a menu of links, so the page's own name keeps
 * the room: the first segment is what truncates, then the page's name last of all.
 */
export function DocumentBreadcrumb({ segments }: { segments: DocumentBreadcrumbSegment[] }) {
  const middle = segments.slice(1, -1);
  return (
    <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
      <ol className="flex min-w-0 items-center text-body text-kh-text-muted">
        {segments.map((segment, index) => {
          const isFirst = index === 0;
          const isLast = index === segments.length - 1;
          const isParent = index === segments.length - 2;
          const isMiddle = !isFirst && !isLast;
          return (
            <Fragment key={`${segment.label}-${index}`}>
            <li
              data-crumb={isFirst ? "first" : isLast ? "last" : "middle"}
              className={`flex items-center ${isMiddle ? "kh-crumb-middle " : ""}${isFirst ? "kh-crumb-first " : ""}${isParent ? "min-w-0 max-w-[76%] shrink-0" : isLast ? "kh-crumb-last min-w-[min(30%,7ch)] flex-auto" : isFirst ? "min-w-0 overflow-hidden focus-within:overflow-visible" : "min-w-0 overflow-hidden focus-within:overflow-visible"}`}
            >
              {index > 0 ? <ChevronRight className="mx-1 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : null}
              {segment.href && !isLast ? (
                <Link href={segment.href} title={segment.label} className="inline-flex min-h-6 min-w-0 items-center rounded-md hover:text-kh-text hover:underline kh-focus-ring">
                  <span className="truncate">{segment.label}</span>
                </Link>
              ) : (
                <span aria-current={isLast ? "page" : undefined} title={segment.label} className="truncate">
                  {segment.label}
                </span>
              )}
            </li>
            {isFirst && middle.length > 0 ? (
          <li data-crumb="collapsed" className="kh-crumb-collapsed shrink-0 items-center">
            <ChevronRight className="mx-1 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <MenuRoot>
              <MenuTrigger aria-label={`Show ${middle.length} more ${middle.length === 1 ? "level" : "levels"} of the path`} className={buttonClasses({ variant: "ghost", size: "sm", icon: true })}>
                <Ellipsis className="h-4 w-4" aria-hidden="true" />
              </MenuTrigger>
              <MenuContent align="start" className="w-56">
                {middle.map((segment, index) => segment.href
                  ? <MenuItem key={`${segment.label}-${index}`} render={<Link href={segment.href} />}><span className="truncate">{segment.label}</span></MenuItem>
                  : <MenuItem key={`${segment.label}-${index}`} disabled><span className="truncate">{segment.label}</span></MenuItem>)}
              </MenuContent>
            </MenuRoot>
          </li>
        ) : null}
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}

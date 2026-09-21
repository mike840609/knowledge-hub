"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ChevronRight, LockKeyhole } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { formatDateTime, formatRelativeTime } from "@/lib/format-date";

export type DocumentBreadcrumbSegment = {
  label: string;
  href?: string;
};

export function DocumentHeader({
  breadcrumb,
  title,
  status,
  updatedAt,
  revisionBanner,
  onDetailsClick,
  editHref,
  readOnly,
  contentOwnsTitle,
}: {
  breadcrumb: DocumentBreadcrumbSegment[];
  title: string;
  status: "ACTIVE" | "ARCHIVED";
  updatedAt: Date;
  revisionBanner: { viewingNo: number; backHref: string } | null;
  onDetailsClick: () => void;
  editHref: string | null;
  readOnly: boolean;
  contentOwnsTitle: boolean;
}) {

  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const elapsed = now === null ? null : Math.max(0, now - new Date(updatedAt).getTime());
  const relative = elapsed === null ? formatDateTime(updatedAt) : formatRelativeTime(elapsed);

  return (
    <header className="bg-kh-bg-raised">
      <div className="kh-reading-column pb-3 pt-5">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
            <ol className="flex min-w-0 items-center gap-1 text-body-sm text-kh-text-muted">
              {breadcrumb.map((segment, index) => {
                const isLast = index === breadcrumb.length - 1;
                return (
                  <li key={`${segment.label}-${index}`} className="flex min-w-0 items-center gap-1">
                    {index > 0 ? <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : null}
                    {segment.href && !isLast ? (
                      <Link href={segment.href} className="shrink-0 rounded-md hover:text-kh-text hover:underline kh-focus-ring">
                        {segment.label}
                      </Link>
                    ) : (
                      <span aria-current={isLast ? "page" : undefined} className="truncate">
                        {segment.label}
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          </nav>
          <div className="flex shrink-0 items-center gap-2">
            {editHref ? (
              <a
                href={editHref}
                className={buttonClasses({ variant: "ghost" })}
              >
                Edit
              </a>
            ) : null}
            <button
              type="button"
              onClick={onDetailsClick}
              aria-keyshortcuts="Meta+I Control+I"
              title="Details (⌘/Ctrl I)"
              className={buttonClasses({ variant: "ghost" })}
            >
              Details
            </button>
          </div>
        </div>
        {contentOwnsTitle ? null : (
          <h1 className="mt-2 truncate text-heading font-semibold tracking-tight text-kh-text" title={title}>{title}</h1>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-kh-text-muted">
          {readOnly ? <span className="inline-flex items-center gap-1"><LockKeyhole className="h-3 w-3" aria-hidden="true" />Read only</span> : null}
          {status === "ARCHIVED" ? <Badge variant="warning">Archived</Badge> : null}
          <time dateTime={new Date(updatedAt).toISOString()} title={formatDateTime(updatedAt)}>Updated {relative}</time>
        </div>
        {revisionBanner ? (
          <p className="mt-2 rounded-md border border-kh-border bg-kh-bg-subtle px-3 py-2 text-body-sm text-kh-text">
            Viewing revision {revisionBanner.viewingNo} —{" "}
            <Link href={revisionBanner.backHref} className="font-medium text-kh-link underline underline-offset-2">
              Back to current
            </Link>
          </p>
        ) : null}
      </div>
    </header>
  );
}

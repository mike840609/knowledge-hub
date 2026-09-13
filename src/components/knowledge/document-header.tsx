"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export type DocumentBreadcrumbSegment = {
  label: string;
  href?: string;
};

function formatUpdatedAt(value: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

export function DocumentHeader({
  breadcrumb,
  title,
  status,
  updatedAt,
  revisionBanner,
  onDetailsClick,
}: {
  breadcrumb: DocumentBreadcrumbSegment[];
  title: string;
  status: "ACTIVE" | "ARCHIVED";
  updatedAt: Date;
  revisionBanner: { viewingNo: number; backHref: string } | null;
  onDetailsClick: () => void;
}) {

  return (
    <header className="sticky top-0 z-10 border-b border-kh-border bg-kh-bg/95 backdrop-blur">
      <div className="mx-auto w-full max-w-[860px] px-6 py-3">
        <nav aria-label="Breadcrumb">
          <ol className="flex min-w-0 items-center gap-1 text-[13px] text-kh-text-muted">
            {breadcrumb.map((segment, index) => {
              const isLast = index === breadcrumb.length - 1;
              return (
                <li key={`${segment.label}-${index}`} className="flex min-w-0 items-center gap-1">
                  {index > 0 ? <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : null}
                  {segment.href && !isLast ? (
                    <Link href={segment.href} className="shrink-0 hover:text-kh-text hover:underline">
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
        <div className="mt-1 flex min-w-0 items-start justify-between gap-3">
          <h1 className="min-w-0 flex-1 truncate text-xl font-semibold tracking-tight text-kh-text" title={title}>
            {title}
          </h1>
          <button
            type="button"
            onClick={onDetailsClick}
            className="inline-flex h-8 shrink-0 items-center rounded-md border border-kh-border bg-kh-bg px-3 text-[13px] font-medium text-kh-text hover:bg-kh-bg-hover"
          >
            Details
          </button>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-kh-text-muted">
          <Badge variant="outline">Read only</Badge>
          {status === "ARCHIVED" ? <Badge variant="warning">Archived</Badge> : null}
          <span>Updated {formatUpdatedAt(updatedAt)}</span>
        </div>
        {revisionBanner ? (
          <p className="mt-2 rounded-md border border-kh-border bg-kh-bg-subtle px-3 py-2 text-[13px] text-kh-text">
            Viewing revision {revisionBanner.viewingNo} —{" "}
            <Link href={revisionBanner.backHref} className="font-medium text-kh-accent underline underline-offset-2">
              Back to current
            </Link>
          </p>
        ) : null}
      </div>
    </header>
  );
}

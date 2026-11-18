import Link from "next/link";
import { ChevronRight } from "lucide-react";

export type DocumentBreadcrumbSegment = {
  label: string;
  href?: string;
};

/** The reader's `location › title` line; the composer draws the same one. */
export function DocumentBreadcrumb({ segments }: { segments: DocumentBreadcrumbSegment[] }) {
  return (
    <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
      <ol className="flex min-w-0 items-center text-body text-kh-text-muted">
        {segments.map((segment, index) => {
          const isLast = index === segments.length - 1;
          const isParent = index === segments.length - 2;
          return (
            <li
              key={`${segment.label}-${index}`}
              className={`flex items-center ${isParent ? "min-w-0 max-w-[58%] shrink-0" : isLast ? "min-w-[min(30%,7ch)] flex-auto" : "min-w-0 overflow-hidden focus-within:overflow-visible"}`}
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
          );
        })}
      </ol>
    </nav>
  );
}

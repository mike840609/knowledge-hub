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
      <ol className="flex min-w-0 items-center gap-1 text-body text-kh-text-muted">
        {segments.map((segment, index) => {
          const isLast = index === segments.length - 1;
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
  );
}

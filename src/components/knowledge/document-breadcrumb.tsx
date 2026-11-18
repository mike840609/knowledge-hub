import Link from "next/link";
import { ChevronRight } from "lucide-react";

export type DocumentBreadcrumbSegment = {
  label: string;
  href?: string;
};

/** The reader's location line, `workspace › source › folders`; the document title is the H1 below. */
export function DocumentBreadcrumb({ segments }: { segments: DocumentBreadcrumbSegment[] }) {
  return (
    <nav aria-label="Breadcrumb" className="min-w-0 flex-1 overflow-hidden">
      <ol className="flex min-w-0 items-center gap-1 text-body text-kh-text-muted">
        {segments.map((segment, index) => {
          const isLast = index === segments.length - 1;
          return (
            // The document title is the H1 below on a phone; the crumb keeps
            // the place, not a second truncated copy of the title.
            <li key={`${segment.label}-${index}`} className={`flex min-w-0 items-center gap-1 ${isLast ? "hidden" : ""}`}>
              {index > 0 ? <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : null}
              {segment.href && !isLast ? (
                <Link href={segment.href} className="inline-flex min-h-6 min-w-0 items-center truncate rounded-md hover:text-kh-text hover:underline kh-focus-ring">
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

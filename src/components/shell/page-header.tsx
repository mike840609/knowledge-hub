import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

/**
 * A page's header is one line, "location › title", with its actions at the
 * right: a page is named where it sits rather than announced above it. It
 * was a breadcrumb, a 20px title and a subtitle stacked over ~76px, which
 * made every list and form page open like a document.
 */
export function PageHeader({
  location,
  locationHref,
  title,
  description,
  actions,
}: {
  location: string;
  locationHref: string;
  title: string;
  /** A line under the header, for a form that needs saying what it does. */
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header>
      <div className="flex min-h-8 min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-1 text-body">
          <nav aria-label="Breadcrumb" className="shrink-0 text-kh-text-muted">
            <Link href={locationHref} className="rounded-md hover:text-kh-text hover:underline kh-focus-ring">
              {location}
            </Link>
          </nav>
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-kh-text-muted" aria-hidden="true" />
          <h1 className="min-w-0 truncate font-medium text-kh-text">{title}</h1>
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {description ? <p className="mt-1 text-body-sm text-kh-text-muted">{description}</p> : null}
    </header>
  );
}

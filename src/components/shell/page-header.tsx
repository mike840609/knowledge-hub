import Link from "next/link";
import type { ReactNode } from "react";

/**
 * A page's header is one line, "location › title", with its actions at the
 * right: a page is named where it sits rather than announced above it. It
 * was a breadcrumb, a 20px title and a subtitle stacked over ~76px, which
 * made every list and form page open like a document.
 *
 * That line is 48px and is the first thing on the page — the page adds no padding above it — so it sits on
 * the same top line as the rail's wordmark row, as a document's breadcrumb does.
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
  title: ReactNode;
  /** A line under the header, for a form that needs saying what it does. */
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="pb-1">
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center text-caption text-kh-text-muted">
        <Link href={locationHref} className="inline-flex min-h-6 min-w-0 items-center rounded-md hover:text-kh-text hover:underline kh-focus-ring">
          {location}
        </Link>
      </nav>
      <div className="mt-0.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h1 className="min-w-0 truncate text-display font-semibold tracking-tight text-kh-text">{title}</h1>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {description ? <p className="mt-1 text-body-sm text-kh-text-muted">{description}</p> : null}
    </header>
  );
}

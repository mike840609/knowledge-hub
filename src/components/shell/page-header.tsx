import Link from "next/link";
import type { ReactNode } from "react";

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
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header>
      <nav aria-label="Breadcrumb" className="text-body-sm text-kh-text-muted">
        <Link href={locationHref} className="rounded-md hover:text-kh-text hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-kh-focus">
          {location}
        </Link>
      </nav>
      <div className="mt-2 flex min-w-0 flex-wrap items-center justify-between gap-3">
        <h1 className="min-w-0 text-heading font-semibold tracking-tight text-kh-text">{title}</h1>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {description ? <p className="mt-1 text-body-sm text-kh-text-muted">{description}</p> : null}
    </header>
  );
}

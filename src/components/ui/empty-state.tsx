import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * What an empty place says: what it is for, what to do about it, and the key
 * that does it.
 *
 * It is not `StatusMessage`. That is the shape of an error or a not-found —
 * something went wrong, here is the way out — and it sits left-aligned like
 * the page it replaced. An empty list is not a fault; it is where the reader
 * starts, so it is centred, has an icon to hold the eye, and leads with the
 * action. Its title names the state ("No documents yet"), never the page.
 *
 * `hint` is for a shortcut the reader would otherwise not learn: the empty
 * state is the one moment they are looking for what to do.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  hint,
}: {
  icon: LucideIcon;
  title: string;
  description: ReactNode;
  action?: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="kh-reading-column flex flex-col items-center py-16 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-kh-bg-subtle text-kh-text-muted">
        <Icon aria-hidden="true" className="h-5 w-5" />
      </span>
      <h2 className="mt-4 text-title font-semibold text-kh-text">{title}</h2>
      <p className="mt-1 max-w-panel text-body text-kh-text-muted">{description}</p>
      {action ? <div className="mt-6 flex flex-wrap justify-center gap-2">{action}</div> : null}
      {hint ? <p className="mt-4 flex items-center gap-1 text-caption text-kh-text-muted">{hint}</p> : null}
    </div>
  );
}

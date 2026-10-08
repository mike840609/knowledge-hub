"use client";

import Link from "next/link";
import { useEffect, useState, type Ref } from "react";
import { LockKeyhole, PanelRight } from "lucide-react";
import { ActionIcon } from "@/components/actions/action-icon";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { formatDateTime, formatRelativeTime } from "@/lib/format-date";
import { useDisplayTimeZone } from "@/components/ui/timestamp";
import { DocumentBreadcrumb, type DocumentBreadcrumbSegment } from "./document-breadcrumb";

export function DocumentHeader({
  breadcrumb,
  title,
  status,
  updatedAt,
  revisionBanner,
  onDetailsClick,
  linkSummary,
  onLinksClick,
  editHref,
  onShareClick,
  readOnly,
  syncHref,
  contentOwnsTitle,
  headerRef,
  pinned = false,
}: {
  breadcrumb: DocumentBreadcrumbSegment[];
  title: string;
  status: "ACTIVE" | "ARCHIVED";
  updatedAt: Date;
  revisionBanner: { viewingNo: number; backHref: string } | null;
  onDetailsClick: () => void;
  /** "3 backlinks" and the like; `null` when the document has no links worth announcing. */
  linkSummary: string | null;
  /** Opens the inspector on its Links tab. */
  onLinksClick: () => void;
  editHref: string | null;
  /** Opens the share-link dialog; null where sharing is not offered (share-link spec §10.1). */
  onShareClick: (() => void) | null;
  readOnly: boolean;
  /** Where a read-only folder-synced document is updated from; null for any other source. */
  syncHref: string | null;
  contentOwnsTitle: boolean;
  /** The part of the header that scrolls away; the shell watches it to know when the document is scrolled. */
  headerRef?: Ref<HTMLElement>;
  /** The header has scrolled away under the pinned breadcrumb, whose lower edge then fades the content in. */
  pinned?: boolean;
}) {

  const [now, setNow] = useState<number | null>(null);
  // Before mount there is no "now" and no zone; both arrive in the same tick,
  // so the first render is the one the server also produced.
  const zone = useDisplayTimeZone();
  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const elapsed = now === null ? null : Math.max(0, now - new Date(updatedAt).getTime());
  const relative = elapsed === null ? formatDateTime(updatedAt, zone) : formatRelativeTime(elapsed);

  return (
    <>
      {/* The location › title line and its actions stay pinned to the top of the pane on a wide screen while
          the rest of the header scrolls away. It is 48px tall, centred on the same line as the rail's and the
          explorer's first rows, so the three columns share one top edge. It sits outside <header> so that sticky is bounded by the whole
          document rather than by the header's own height. */}
      <div data-pinned={pinned || undefined} className="z-10 bg-kh-bg lg:kh-fade-below lg:sticky lg:top-0">
      <div className="kh-reading-column flex min-w-0 items-center justify-between gap-3 py-2">
        <DocumentBreadcrumb segments={breadcrumb} />
        {/* Icon-only so the header stays light; each keeps its name as
            aria-label and tooltip. Details draws the same glyph as the
            narrow topbar's copy of this button. */}
        <div className="flex shrink-0 items-center gap-2">
          {editHref ? (
            <Tooltip label="Edit" shortcut="E">
              <a
                href={editHref}
                aria-label="Edit"
                aria-keyshortcuts="E"
                className={buttonClasses({ variant: "ghost", icon: true })}
              >
                <ActionIcon name="edit" className="h-4 w-4" />
              </a>
            </Tooltip>
          ) : null}
          {onShareClick ? (
            <Tooltip label="Share link…">
              <button
                type="button"
                onClick={onShareClick}
                aria-label="Share link…"
                className={buttonClasses({ variant: "ghost", icon: true })}
              >
                <ActionIcon name="share" className="h-4 w-4" />
              </button>
            </Tooltip>
          ) : null}
          <Tooltip label="Details" shortcut="Meta+I Control+I">
            <button
              type="button"
              onClick={onDetailsClick}
              aria-label="Details"
              aria-keyshortcuts="Meta+I Control+I"
              className={buttonClasses({ variant: "ghost", icon: true })}
            >
              <PanelRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </Tooltip>
        </div>
      </div>
      </div>
      <header ref={headerRef}>
        <div className="kh-reading-column pb-3">
          {contentOwnsTitle ? null : (
            <h1 className="mt-2 truncate text-heading font-semibold tracking-tight text-kh-text" title={title}>{title}</h1>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-kh-text-muted">
            {readOnly ? <span className="inline-flex items-center gap-1"><LockKeyhole className="h-3 w-3" aria-hidden="true" />Read only</span> : null}
            {readOnly ? (
              // Source ownership decides who may write: say where the edit happens instead of only refusing it.
              <span>
                {syncHref ? <>Edit the file in your folder, then{" "}
                  <Link href={syncHref} className="kh-focus-ring rounded-md text-kh-link underline-offset-2 hover:underline">update from folder</Link></> : "Managed by its source"}
              </span>
            ) : null}
            {status === "ARCHIVED" ? <Badge variant="warning">Archived</Badge> : null}
            <time dateTime={new Date(updatedAt).toISOString()} title={formatDateTime(updatedAt, zone)}>Updated {relative}</time>
            {linkSummary ? (
              // The padding makes a 24px target (WCAG 2.5.8) and the negative
              // margins give it back, so a document with links is not a row taller
              // than one without and the header does not jump between them.
              <Tooltip label="Show links in the details panel">
              <button
                type="button"
                onClick={onLinksClick}
                className="-mx-1.5 -my-1 inline-flex h-6 items-center gap-1 rounded-md px-1.5 tabular-nums hover:bg-kh-bg-hover hover:text-kh-text kh-focus-ring"
              >
                <ActionIcon name="graph" className="h-3 w-3 shrink-0" />
                {linkSummary}
              </button>
              </Tooltip>
            ) : null}
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
    </>
  );
}

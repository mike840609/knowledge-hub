"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Popover } from "@base-ui-components/react/popover";
import { LockKeyhole } from "lucide-react";
import { ActionIcon } from "@/components/actions/action-icon";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";
import { useDisplayTimeZone } from "@/components/ui/timestamp";
import { formatDateTime, formatRelativeTime } from "@/lib/format-date";
import { OutlineDisclosure } from "./document-outline";
import type { OutlineEntry } from "@/shared/markdown/outline";

export type DocumentMetaProps = {
  status: "ACTIVE" | "ARCHIVED";
  updatedAt: Date;
  readOnly: boolean;
  /** Where a read-only folder-synced document is updated from; null for any other source. */
  syncHref: string | null;
  readOnlyReason?: ReactNode;
  wordCount?: number;
  editHint?: ReactNode;
  linkSummary?: string | null;
  onLinksClick?: () => void;
};

/**
 * Read only as a compact badge. Its explanation, with the way to update the page, opens from it on hover,
 * focus-and-Enter and tap, and is a real popover (its link can be reached and followed), not a `title`.
 */
export function ReadOnlyBadge({ syncHref }: { syncHref: string | null }) {
  return (
    <Popover.Root>
      <Popover.Trigger
        openOnHover
        delay={200}
        className="kh-focus-ring inline-flex items-center gap-1 rounded-sm border border-kh-border bg-kh-bg-subtle px-1.5 py-0.5 text-caption font-medium text-kh-text-muted hover:text-kh-text"
      >
        <LockKeyhole className="h-3 w-3" aria-hidden="true" /><span>Read only</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={6} className="z-[80]">
          <Popover.Popup className="max-w-[min(20rem,calc(100vw-2rem))] rounded-lg border border-kh-border bg-kh-bg-raised px-3 py-2 text-body-sm text-kh-text shadow-popover outline-none transition-[opacity,transform] duration-120 ease-out data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0 data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0">
            <Popover.Title className="sr-only">Read only</Popover.Title>
            {/* Source ownership decides who may write: say where the edit happens instead of only refusing it. */}
            <Popover.Description render={<p />}>
              {syncHref ? <>Edit the file in your folder, then{" "}
                <Link href={syncHref} className="kh-focus-ring rounded-md text-kh-link underline underline-offset-2">update from folder</Link></> : "Managed by its source"}
            </Popover.Description>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** The line under a page's title: read only, when it was updated, how many words, what links to it. */
export function DocumentMeta({ status, updatedAt, readOnly, syncHref, readOnlyReason, wordCount, editHint, linkSummary, onLinksClick }: DocumentMetaProps) {
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
    <div data-document-meta className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-kh-text-muted">
      {readOnlyReason}
      {readOnly ? <ReadOnlyBadge syncHref={syncHref} /> : null}
      {status === "ARCHIVED" ? <Badge variant="warning">Archived</Badge> : null}
      <time dateTime={new Date(updatedAt).toISOString()} title={formatDateTime(updatedAt, zone)}>Updated {relative}</time>
      {wordCount ? <>
        <span aria-hidden="true" className="text-kh-text-faint">·</span>
        <span className="sr-only">, </span>
        <span className="tabular-nums">{wordCount.toLocaleString("en-US")} {wordCount === 1 ? "word" : "words"}</span>
      </> : null}
      {editHint ? <span className="hidden items-center gap-x-2 sm:inline-flex">
        {/* The meta line is a row of separate facts; without a separator "10 days ago"
            and the hint after it read as one sentence. `gap` is not text, so copy/paste
            and speech both need a real one: a dot for the eye, a comma for AT. The count
            is always there and the hint follows it, so the hint going moves nothing already
            on the line; below `sm` there is no room for both on one line, and the hint is not drawn. */}
        <span aria-hidden="true" className="text-kh-text-faint">·</span>
        <span className="sr-only">, </span>
        <span>{editHint}</span>
      </span> : null}
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
  );
}

/**
 * What a page whose own text opens with its `#` title draws right under that title instead of above it: the meta
 * line and, in a narrow window, the "On this page" disclosure. The page provides it; the reader's `afterTitle` and
 * the editor's title slot place it.
 */
export const DocumentMetaContext = createContext<{ meta: DocumentMetaProps; outline: { entries: readonly OutlineEntry[]; activeSlug: string | null } } | null>(null);

export function DocumentMetaSlot() {
  const context = useContext(DocumentMetaContext);
  if (!context) return null;
  return (
    <div className="mb-3 mt-1.5">
      <DocumentMeta {...context.meta} />
      <OutlineDisclosure entries={context.outline.entries} activeSlug={context.outline.activeSlug} bare />
    </div>
  );
}

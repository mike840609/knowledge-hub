"use client";

import Link from "next/link";
import { type Ref, type ReactNode } from "react";
import { MessageSquare, MoreHorizontal, PanelRight } from "lucide-react";
import { toggleFullWidth, useFullWidth } from "./use-full-width";
import { ActionIcon } from "@/components/actions/action-icon";
import { ActionMenuItems } from "@/components/actions/action-menu";
import type { Action } from "@/components/actions/action-registry";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { MenuCheckboxItem, MenuContent, MenuRoot, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { Tooltip } from "@/components/ui/tooltip";
import { DocumentMeta } from "./document-meta";
import { DocumentBreadcrumb, type DocumentBreadcrumbSegment } from "./document-breadcrumb";
import { useReviewEntry } from "./review-entry";

export function DocumentHeader({
  breadcrumb,
  title,
  status,
  updatedAt,
  revisionBanner,
  onDetailsClick,
  linkSummary,
  onLinksClick,
  onShareClick,
  readOnly,
  syncHref,
  contentOwnsTitle,
  headerRef,
  pinned = false,
  titleControl,
  editorActions,
  editHint,
  wordCount,
  showFullWidth = true,
  readOnlyReason,
  actions,
  onRunAction,
  beforeTitle,
  metaAfterTitle = false,
}: {
  titleControl?: ReactNode;
  /** The meta line is drawn by `DocumentMetaSlot` under the article's own `#` title; the header leaves it out. */
  metaAfterTitle?: boolean;
  /** Above the title: the page's icon, when there is one to show. */
  beforeTitle?: ReactNode;
  /** The editor's own: its save status and the Markdown toggle, before Share. */
  editorActions?: ReactNode;
  /** A first-visit cue that the text itself is the editor; kept in the metadata row, not the article. */
  editHint?: ReactNode;
  /** Words on the page, shown beside when it was updated, once the edit hint has gone (both on one line would wrap a phone-width header, and the layout must not move when the hint goes); omitted where it is not counted. */
  wordCount?: number;
  /** The Full width setting; a header drawn beside another document page (the side peek) leaves it to that page. */
  showFullWidth?: boolean;
  readOnlyReason?: ReactNode;
  /** The page's own actions, from the one registry. Already narrowed to what this surface shows. */
  actions?: readonly Action[];
  onRunAction?: (action: Action) => void;
  breadcrumb: DocumentBreadcrumbSegment[];
  title: string;
  status: "ACTIVE" | "ARCHIVED";
  updatedAt: Date;
  revisionBanner: { viewingNo: number; backHref: string } | null;
  onDetailsClick?: () => void;
  /** "3 backlinks" and the like; `null` when the document has no links worth announcing. */
  linkSummary?: string | null;
  /** Opens the inspector on its Links tab. */
  onLinksClick?: () => void;
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

  const fullWidth = useFullWidth();
  const review = useReviewEntry();
  const hasActions = !!actions?.length && !!onRunAction;
  return (
    <>
      {/* The location › title line and its actions stay pinned to the top of the pane on a wide screen while
          the rest of the header scrolls away. It is 48px tall, centred on the same line as the rail's and the
          explorer's first rows, so the three columns share one top edge. It sits outside <header> so that sticky is bounded by the whole
          document rather than by the header's own height. */}
      <div data-pinned={pinned || undefined} className="z-10 bg-kh-bg lg:sticky lg:top-0">
      <div className="kh-reading-column kh-document-toolbar flex min-h-12 min-w-0 items-center justify-between gap-1 py-2 sm:gap-3">
        <DocumentBreadcrumb segments={breadcrumb} />
        <div className="flex shrink-0 items-center gap-1">
          {editorActions}
          {onShareClick ? (
            <Tooltip label="Share link…">
              <button
                type="button"
                onClick={onShareClick}
                aria-label="Share link…"
                // The page's main action says its name where there is room, and is the icon alone where there is not.
                className={buttonClasses({ variant: "ghost", icon: true, className: "sm:w-auto sm:gap-1.5 sm:border-kh-border-strong sm:bg-kh-bg sm:px-2.5 sm:text-kh-text sm:hover:bg-kh-bg-hover" })}
              >
                <ActionIcon name="share" className="h-4 w-4" />
                <span className="hidden sm:inline">Share</span>
              </button>
            </Tooltip>
          ) : null}
          {/* What is done to the document comes first; then the two that open something on the right,
              together and nearest to it: the discussions, and Details. */}
          {review?.entry ? (
            <Tooltip label={review.entry.open ? "Hide comments" : review.entry.count === 0 ? "Comments · No comments yet" : `Comments · ${review.entry.awaiting} open, ${review.entry.count} total`}>
              <button
                ref={review.buttonRef}
                type="button"
                aria-label={`${review.entry.open ? "Hide comments" : "Show comments"}, ${review.entry.count} comments, ${review.entry.awaiting} open`}
                aria-expanded={review.entry.open}
                aria-controls="owner-document-discussions"
                onPointerDown={(event) => event.preventDefault()}
                onClick={review.entry.toggle}
                className={buttonClasses({ variant: "ghost", icon: review.entry.awaiting === 0 && review.entry.unread === 0 })}
              >
                <MessageSquare className="h-4 w-4" aria-hidden="true" />
                {/* The number is what awaits an answer, which is what the list opens on; none, and it is the glyph alone. */}
                {review.entry.awaiting > 0 ? <span aria-hidden="true">{review.entry.awaiting}</span> : null}
                {review.entry.unread > 0 ? <Badge variant="warning" aria-label={`${review.entry.unread} unread share comments`}>{review.entry.unread} new</Badge> : null}
              </button>
            </Tooltip>
          ) : null}
          {onDetailsClick ? (
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
          ) : null}
          {hasActions || showFullWidth ? (
            <MenuRoot>
              <MenuTrigger aria-label="Document actions" className={buttonClasses({ variant: "ghost", icon: true, className: hasActions ? "" : "hidden sm:inline-flex" })}>
                <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
              </MenuTrigger>
              <MenuContent align="end" className="w-56">
                {hasActions ? <ActionMenuItems actions={actions} onRun={onRunAction} /> : null}
                {showFullWidth ? <>
                  {hasActions ? <MenuSeparator className="hidden sm:block" /> : null}
                  <MenuCheckboxItem className="hidden sm:flex" checked={fullWidth} onCheckedChange={toggleFullWidth}>Full width</MenuCheckboxItem>
                </> : null}
              </MenuContent>
            </MenuRoot>
          ) : null}
        </div>
      </div>
      </div>
      <header ref={headerRef}>
        <div className="kh-reading-column pb-3">
          {beforeTitle}
          {titleControl ? (
            <>
              {/* The field is the visible title; a heading is what assistive tech navigates by,
                  and a document whose markdown has no `#` line has no other one. When the markdown
                  does open with `#`, that heading is the only h1: a field can still be drawn over
                  it (a frontmatter title wins the resolver), so this must not add a second. */}
              {title && !contentOwnsTitle ? <h1 className="sr-only">{title}</h1> : null}
              {titleControl}
            </>
          ) : contentOwnsTitle ? null : (
            <h1 className="mt-2 break-words text-page-title font-semibold tracking-tight text-kh-text" title={title}>{title}</h1>
          )}
          {/* Under the title. A page whose own text opens with `# Title` has its title in the article, so the line goes
              right under that (DocumentMetaSlot) instead of above it. */}
          {metaAfterTitle ? null : <div className="mt-1.5"><DocumentMeta status={status} updatedAt={updatedAt} readOnly={readOnly} syncHref={syncHref} readOnlyReason={readOnlyReason} wordCount={wordCount} editHint={editHint} linkSummary={linkSummary} onLinksClick={onLinksClick} /></div>}
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

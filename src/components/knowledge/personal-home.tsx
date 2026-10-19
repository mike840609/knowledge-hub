"use client";

import { GuidanceVisibilityContext } from "./guidance-visibility";
import { ReopenGuidanceMenuItem } from "./reopen-guidance-menu-item";
import { useState, type ReactNode } from "react";
import { RECENT_SHOWN, homeLists, type ContinueDoc, type ContinueDraft, type DraftItem, type RecentItem } from "@/lib/home-continue";
import { AttentionList, UnreadDiscussions, type HomeNotice } from "./home-attention";
import type { FreshnessReminder } from "@/modules/personal/application/knowledge-freshness";

import Link from "next/link";
import { FileText, PenLine, Star, MoreHorizontal } from "lucide-react";
import { navigateListRows } from "@/lib/list-row-navigation";
import { useDocumentShortcuts, documentShortcutKey } from "./use-document-shortcuts";
import { toggleFavoriteDocument } from "@/lib/document-shortcuts";
import { Button, buttonClasses } from "@/components/ui/button";
import { PageHeader } from "@/components/shell/page-header";
import { Timestamp } from "@/components/ui/timestamp";
import { Tooltip } from "@/components/ui/tooltip";
import { actionsFor, type Action } from "@/components/actions/action-registry";
import { RowActionsTrigger, RowContextMenu, useActionRunner } from "@/components/actions/action-menu";
import { useWorkspaceAuthorization } from "@/components/shell/use-workspace-authorization";
import { MenuRoot, MenuTrigger, MenuContent, MenuItem } from "@/components/ui/menu";
import { ShareLinkDialogHost } from "./share-link-dialog";
import { useHydrated } from "@/components/shell/use-hydrated";

type Doc = ContinueDoc;

/** A labelled group of rows; the label is the rail's group-label style, not a heading-size title. */
function Section({ title, count, action, children }: { title: string; count?: number; action?: ReactNode; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="min-w-0">
      <div className="flex items-baseline justify-between gap-3 px-3 pb-2">
        <h2 className="text-caption font-medium text-kh-text-muted">
          {title}{count ? <span className="ml-1.5 text-kh-selected-text">{count}</span> : null}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function EmptyLine({ children }: { children: React.ReactNode }) {
  return <p className="px-3 py-2 text-body text-kh-text-muted">{children}</p>;
}

/**
 * One row, and the whole row is the link — as `SourceListRow` and the search
 * results are. The favourite toggle sits beside the link rather than inside
 * it, so it is its own target and a click on it never navigates.
 */
function EventTime({ timestamp, eventLabel }: { timestamp?: string; eventLabel?: string }) {
  return <>
    {eventLabel ? <span className="text-kh-text-muted">{eventLabel}</span> : null}
    {eventLabel && timestamp ? " " : null}
    {timestamp ? <Timestamp value={timestamp} variant="relative" /> : null}
  </>;
}

function Row({ href, icon, title, timestamp, eventLabel, provenance, trailing, actions = [], onRun = () => {} }: {
  href: string;
  icon: React.ReactNode;
  title: string;
  timestamp?: string;
  /** Names the event beside the time ("Edited", "Opened"). */
  eventLabel?: string;
  provenance?:string;
  trailing?: React.ReactNode;
  actions?: readonly Action[];
  onRun?: (action: Action) => void;
}) {
  return (
    <RowContextMenu actions={actions} onRun={onRun} className="kh-interactive-row group flex min-h-8 items-center pr-1">
      <Link
        data-list-row
        href={href}
        className="kh-focus-ring flex min-h-8 min-w-0 flex-1 items-center gap-3 rounded-md px-3"
      >
        <span className="shrink-0 text-kh-text-muted">{icon}</span>
        {/* One line from `sm` up: title, then provenance beside it; on a phone the meta drops below. */}
        <span className="min-w-0 flex-1 py-1 sm:flex sm:items-baseline sm:gap-2">
          <span className="block min-w-0 truncate text-body font-medium text-kh-text">{title}</span>
          {provenance ? <span className="hidden min-w-0 truncate text-caption text-kh-text-muted sm:block">{provenance}</span> : null}
          {provenance || timestamp || eventLabel ? <span className="block truncate text-caption text-kh-text-muted sm:hidden">
            {provenance}{provenance && (timestamp || eventLabel) ? " · " : null}<EventTime timestamp={timestamp} eventLabel={eventLabel} />
          </span> : null}
        </span>
        {timestamp || eventLabel ? <span className="hidden shrink-0 text-caption text-kh-text-muted sm:block"><EventTime timestamp={timestamp} eventLabel={eventLabel} /></span> : null}
      </Link>
      {trailing}
      <RowActionsTrigger actions={actions} onRun={onRun} label={title} className="kh-row-action mr-1" />
    </RowContextMenu>
  );
}

export function PersonalHome({ workspaceId, documents, drafts, reminders = [], notices = [], slots, guidanceDismissed = false }: { guidanceDismissed?: boolean; slots?: { guidance?: ReactNode }; workspaceId: string; documents: Doc[]; drafts: ContinueDraft[]; reminders?: FreshnessReminder[]; notices?: HomeNotice[] }) {
  const [dismissed, setDismissed] = useState(guidanceDismissed);
  const { shortcuts, update } = useDocumentShortcuts(workspaceId);
  const hydrated = useHydrated();
  const { access, confirmed } = useWorkspaceAuthorization();
  const runAction = useActionRunner({ onToggleFavorite: (sourceId, documentId) => update(state => toggleFavoriteDocument(state, documentShortcutKey(sourceId, documentId))) });
  const keyOf = (doc: Doc) => documentShortcutKey(doc.sourceId, doc.documentId);
  const lists = homeLists({ documents, drafts, recent: shortcuts.recent, openedAt: shortcuts.openedAt });
  const [showAllRecent, setShowAllRecent] = useState(false);
  const hiddenRecent = lists.recent.length - RECENT_SHOWN;
  const favorites = shortcuts.favorites
    .map(key => documents.find(doc => keyOf(doc) === key))
    .filter((doc): doc is Doc => !!doc && doc.status === "ACTIVE" && doc.sourceStatus === "ACTIVE");
  // ponytail: every favourite is listed; add the rail's "show all" cut-off if lists grow past a screen.
  // A source name every visible row shares tells the reader nothing; name it only when the rows differ.
  const shown = [...lists.drafts.flatMap(item => item.doc ? [item.doc] : []), ...lists.recent.map(item => item.doc), ...favorites];
  const manySources = new Set(shown.map(doc => doc.sourceId)).size > 1;

  function documentRow(doc: Doc, { timestamp, eventLabel }: { timestamp?: string; eventLabel?: string }) {
    const key = keyOf(doc);
    const favorite = shortcuts.favorites.includes(key);
    const actions = actionsFor("row", { workspaceId, workspaceType: "PERSONAL", can: access.actions, confirmed,
      target: { ...doc, label: doc.title, favorite, revision: "CURRENT" },
    }).filter(action => action.id !== "document.move");
    const label = `${favorite ? "Remove favorite" : "Favorite"}: ${doc.title}`;
    return (
      <Row
        key={key}
        href={`/w/${workspaceId}/knowledge/${doc.sourceId}/${doc.documentId}`}
        icon={<FileText size={14} aria-hidden="true" />}
        title={doc.title}
        timestamp={timestamp} eventLabel={eventLabel}
        provenance={[manySources ? doc.sourceName : undefined, doc.sourcePath].filter(Boolean).join(" · ")}
        actions={actions}
        onRun={runAction}
        trailing={
          <Tooltip label={favorite ? "Remove from favorites" : "Add to favorites"}>
            <Button
              variant="ghost"
              icon
              size="sm"
              disabled={!hydrated}
              onClick={() => update((state) => toggleFavoriteDocument(state, key))}
              aria-label={label}
              className={favorite ? "text-kh-selected-text" : "kh-row-action"}
            >
              <Star size={14} fill={favorite ? "currentColor" : "none"} aria-hidden="true" />
            </Button>
          </Tooltip>
        }
      />
    );
  }

  function draftRow(item: DraftItem) {
    const href = item.doc ? `/w/${workspaceId}/knowledge/${item.doc.sourceId}/${item.doc.documentId}/edit` : `/w/${workspaceId}/knowledge/new`;
    // Draft rows have no star or menu; invisible copies of both keep their times on the same edge as Recent's.
    const slot = buttonClasses({ variant: "ghost", icon: true, size: "sm", className: "invisible" });
    return <Row key={item.id} href={href} icon={<PenLine size={14} aria-hidden="true" />} title={item.draft.title || "Untitled draft"} timestamp={item.at}
      trailing={<span aria-hidden="true" className="mr-1 flex shrink-0"><span className={slot} /><span className={slot} /></span>} />;
  }

  const recentRow = (item: RecentItem) => documentRow(item.doc, { timestamp: item.at, eventLabel: item.label });

  return (
    <GuidanceVisibilityContext.Provider value={{ dismissed, setDismissed }}>
    <div className="kh-page space-y-6 pb-6">
      <PageHeader
        location="My Space"
        locationHref={`/w/${workspaceId}/home`}
        title="Home"
        actions={<>
          <Link className={buttonClasses({ variant: "secondary" })} href={`/w/${workspaceId}/knowledge/new`}>New note</Link>
          <MenuRoot>
            <MenuTrigger aria-label="Home actions" className={buttonClasses({ variant: "ghost", icon: true })}><MoreHorizontal size={16} aria-hidden="true" /></MenuTrigger>
            <MenuContent align="end" className="w-72">
              {/* Only what the primary nav does not already offer: Sources, Insights and Knowledge live there. */}
              <MenuItem render={<Link href={`/w/${workspaceId}/agent-context`} />}>Copy for Agent</MenuItem>
              <ReopenGuidanceMenuItem workspaceId={workspaceId} />
              <MenuItem render={<a href={`/api/workspaces/${workspaceId}/export`} />}>Export Markdown ZIP</MenuItem>
              <p className="px-3 py-2 text-caption text-kh-text-muted">Export includes saved and archived notes. Drafts, history and attachments are excluded.</p>
            </MenuContent>
          </MenuRoot>
        </>}
      />
      {slots?.guidance}
      <AttentionList workspaceId={workspaceId} reminders={reminders} />
      {/* Wide screens set Discussions and Favorites beside the work lists, so the whole page fits without scrolling. */}
      <div className="-mx-3 grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-6">
          {lists.drafts.length ? <Section title="Drafts" count={lists.drafts.length}>
            <ul onKeyDown={navigateListRows} className="space-y-0.5">{lists.drafts.map(draftRow)}</ul>
          </Section> : null}
          <Section title="Recent">
            {lists.recent.length ? <ul onKeyDown={navigateListRows} className="space-y-0.5">{(showAllRecent ? lists.recent : lists.recent.slice(0, RECENT_SHOWN)).map(recentRow)}</ul>
              : <EmptyLine>Documents you edit or open will appear here.{documents.length === 0 && dismissed ? <ReopenGuidanceMenuItem workspaceId={workspaceId} surface="empty" /> : null}</EmptyLine>}
            {hiddenRecent > 0 ? <Button variant="ghost" size="sm" className="mx-3 mt-1 text-kh-text-muted" aria-expanded={showAllRecent} onClick={() => setShowAllRecent(!showAllRecent)}>
              {showAllRecent ? "Show fewer" : `Show ${hiddenRecent} more`}
            </Button> : null}
          </Section>
        </div>
        <div className="min-w-0 space-y-6">
          <Section title="Discussions" count={notices.length} action={<Link className="kh-focus-ring rounded-md text-caption text-kh-link" href={`/w/${workspaceId}/inbox`}>Open Inbox</Link>}>
            {notices.length ? <UnreadDiscussions notices={notices} /> : <EmptyLine>No new comments or replies.</EmptyLine>}
          </Section>
          <Section title="Favorites">
            {favorites.length ? <ul onKeyDown={navigateListRows} className="space-y-0.5">{favorites.map(doc => documentRow(doc, {}))}</ul>
              : <EmptyLine>Star a document to keep it here.</EmptyLine>}
          </Section>
        </div>
      </div>
      <Link className="kh-focus-ring -mx-3 inline-block rounded-md px-3 py-2 text-body-sm text-kh-link" href={`/w/${workspaceId}/knowledge`}>Browse knowledge</Link>
      <ShareLinkDialogHost />
    </div>
    </GuidanceVisibilityContext.Provider>
  );
}

"use client";

import { GuidanceVisibilityContext } from "./guidance-visibility";
import { bufferTyping, plainClick } from "./typing-ahead";
import { ReopenGuidanceMenuItem } from "./reopen-guidance-menu-item";
import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { RECENT_SHOWN, homeLists, recentGroups, type ContinueDoc, type ContinueDraft, type DraftItem, type RecentItem } from "@/lib/home-continue";
import { AttentionList, HomeSection as Section, UnreadDiscussions, type HomeNotice } from "./home-attention";
import type { FreshnessReminder } from "@/modules/personal/application/knowledge-freshness";

import Link from "next/link";
import { ArrowRight, FileText, PenLine, Star, MoreHorizontal, Search, Plus } from "lucide-react";
import { Kbd } from "@/components/ui/kbd";
import { requestQuickSearch } from "@/components/search/search-nav-item";
import { navigateListRows } from "@/lib/list-row-navigation";
import { isSingleKeyShortcut, type KeyEventLike } from "@/lib/shortcut-keys";
import { useDocumentShortcuts, documentShortcutKey } from "./use-document-shortcuts";
import { toggleFavoriteDocument } from "@/lib/document-shortcuts";
import { Button, buttonClasses } from "@/components/ui/button";
import { PageHeader } from "@/components/shell/page-header";
import { Timestamp, useDisplayTimeZone } from "@/components/ui/timestamp";
import { Tooltip } from "@/components/ui/tooltip";
import { actionsFor, type Action } from "@/components/actions/action-registry";
import { RowActionsTrigger, RowContextMenu, useActionRunner } from "@/components/actions/action-menu";
import { useWorkspaceAuthorization } from "@/components/shell/use-workspace-authorization";
import { MenuRoot, MenuTrigger, MenuContent, MenuItem } from "@/components/ui/menu";
import { useHydrated } from "@/components/shell/use-hydrated";
import { RowPreviewButton } from "./row-preview-button";

type Doc = ContinueDoc;

/** A list's empty state is background, not content: caption size, so it never reads as a row. */
function EmptyLine({ children }: { children: React.ReactNode }) {
  return <p className="px-3 py-1 text-caption text-kh-text-muted">{children}</p>;
}

/**
 * One row, and the whole row is the link — as `SourceListRow` and the search
 * results are. The favourite toggle sits beside the link rather than inside
 * it, so it is its own target and a click on it never navigates.
 */
function EventTime({ timestamp, eventLabel }: { timestamp?: string; eventLabel?: string }) {
  // The event and a short time ("Edited 23h"), the full date in the tooltip; untimed, the event is all there is to say.
  if (!timestamp) return eventLabel ? <span className="text-kh-text-muted">{eventLabel}</span> : null;
  return <>
    {eventLabel ? `${eventLabel} ` : null}
    <Timestamp value={timestamp} variant="short" label={eventLabel} className="tabular-nums" />
  </>;
}

function Row({ href, icon, title, timestamp, eventLabel, provenance, stackProvenance = false, hint, keyShortcuts, trailing, actions = [], onRun = () => {} }: {
  href: string;
  icon: React.ReactNode;
  title: string;
  timestamp?: string;
  /** Names the event beside the time ("Edited", "Opened"). */
  eventLabel?: string;
  provenance?:string;
  /** The narrow Favorites column stacks provenance under the title instead of squeezing both onto one line. */
  stackProvenance?: boolean;
  /** What the row does, before its time: only the latest draft has one. */
  hint?: React.ReactNode;
  keyShortcuts?: string;
  trailing?: React.ReactNode;
  actions?: readonly Action[];
  onRun?: (action: Action) => void;
}) {
  return (
    <RowContextMenu actions={actions} onRun={onRun} className="kh-interactive-row group flex min-h-8 items-center pr-1">
      <Link
        data-list-row
        href={href}
        aria-keyshortcuts={keyShortcuts}
        className="kh-focus-ring flex min-h-8 min-w-0 flex-1 items-center gap-3 rounded-md px-3"
      >
        <span className="shrink-0 text-kh-text-muted">{icon}</span>
        {stackProvenance ? (
          <span className="min-w-0 flex-1 py-1">
            <span className="block min-w-0 truncate text-body font-medium text-kh-text">{title}</span>
            {provenance || timestamp || eventLabel ? <span className="mt-0.5 block truncate text-caption text-kh-text-muted">
              {provenance}{provenance && (timestamp || eventLabel) ? " · " : null}<EventTime timestamp={timestamp} eventLabel={eventLabel} />
            </span> : null}
          </span>
        ) : (
          <span className="min-w-0 flex-1 py-1 sm:flex sm:items-baseline sm:gap-2">
            <span className="block min-w-0 truncate text-body font-medium text-kh-text">{title}</span>
            {provenance ? <span className="hidden min-w-0 truncate text-caption text-kh-text-muted sm:block">{provenance}</span> : null}
            {provenance || timestamp || eventLabel ? <span className="block truncate text-caption text-kh-text-muted sm:hidden">
              {provenance}{provenance && (timestamp || eventLabel) ? " · " : null}<EventTime timestamp={timestamp} eventLabel={eventLabel} />
            </span> : null}
          </span>
        )}
        {hint}
        {!stackProvenance && (timestamp || eventLabel) ? <span className="hidden shrink-0 text-caption text-kh-text-muted sm:block"><EventTime timestamp={timestamp} eventLabel={eventLabel} /></span> : null}
      </Link>
      {trailing}
      <RowPreviewButton actions={actions} label={title} className="kh-row-action hidden lg:flex" />
      <RowActionsTrigger actions={actions} onRun={onRun} label={title} className="kh-row-action mr-1" />
    </RowContextMenu>
  );
}

/**
 * Home's page keys — `C` opens a new note, `R` resumes the latest draft — on Home only. Home has no
 * editor, so a key cannot be a character someone meant to type; they are mounted with Home and gone
 * on any other page, where the inline editor keeps every letter (inline-editing spec, "Typing-first
 * keyboard behavior"). Not in a field, menu or dialog, not mid-composition, not with a modifier
 * (`isSingleKeyShortcut`), and not on the search bar, where a key means search.
 */
function isHomeKey(event: KeyEventLike & { defaultPrevented: boolean }, key: "c" | "r"): boolean {
  if (event.defaultPrevented || event.key.toLowerCase() !== key || !isSingleKeyShortcut(event)) return false;
  const target = event.target as { closest?: (selector: string) => unknown } | null;
  return !(typeof target?.closest === "function" && target.closest("[data-home-search]"));
}
export const isNewNoteKey = (event: KeyEventLike & { defaultPrevented: boolean }) => isHomeKey(event, "c");
export const isResumeDraftKey = (event: KeyEventLike & { defaultPrevented: boolean }) => isHomeKey(event, "r");

export function PersonalHome({ workspaceId, documents, drafts, reminders = [], notices = [], slots, guidanceDismissed = false }: { guidanceDismissed?: boolean; slots?: { guidance?: ReactNode }; workspaceId: string; documents: Doc[]; drafts: ContinueDraft[]; reminders?: FreshnessReminder[]; notices?: HomeNotice[] }) {
  const [dismissed, setDismissed] = useState(guidanceDismissed);
  const router = useRouter();
  const newNoteHref = `/w/${workspaceId}/knowledge/new`;
  const { shortcuts, update } = useDocumentShortcuts(workspaceId);
  const hydrated = useHydrated();
  const { access, confirmed } = useWorkspaceAuthorization();
  const runAction = useActionRunner({ onToggleFavorite: (sourceId, documentId) => update(state => toggleFavoriteDocument(state, documentShortcutKey(sourceId, documentId))) });
  const keyOf = (doc: Doc) => documentShortcutKey(doc.sourceId, doc.documentId);
  const lists = homeLists({ documents, drafts, recent: shortcuts.recent, openedAt: shortcuts.openedAt });
  const resumeHref = lists.drafts[0] ? draftDestination(lists.drafts[0]).href : undefined;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isNewNoteKey(event)) {
        event.preventDefault();
        bufferTyping();
        router.push(newNoteHref);
      } else if (resumeHref && isResumeDraftKey(event)) {
        event.preventDefault();
        router.push(resumeHref);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [router, newNoteHref, resumeHref]);
  // Recent's day groups need the reader's zone and clock, which the server cannot know: the first paint is the
  // flat list, as Timestamp's first paint is UTC. ponytail: the clock is read once, so a page left open past
  // midnight keeps yesterday's groups until it is opened again.
  const zone = useDisplayTimeZone();
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => setNow(Date.now()), []);
  const activeDocumentCount = documents.filter(doc => doc.status === "ACTIVE" && doc.sourceStatus === "ACTIVE").length;
  const [showAllRecent, setShowAllRecent] = useState(false);
  const hiddenRecent = lists.recent.length - RECENT_SHOWN;
  const favorites = shortcuts.favorites
    .map(key => documents.find(doc => keyOf(doc) === key))
    .filter((doc): doc is Doc => !!doc && doc.status === "ACTIVE" && doc.sourceStatus === "ACTIVE");
  // ponytail: every favourite is listed; add the rail's "show all" cut-off if lists grow past a screen.
  const recentShown = showAllRecent ? lists.recent : lists.recent.slice(0, RECENT_SHOWN);
  // A source name every visible row shares tells the reader nothing; name it only when the rows differ,
  // and then only where it changes from the row above, as a repeated name says nothing either.
  const shown = [...lists.drafts.flatMap(item => item.doc ? [item.doc] : []), ...recentShown.map(item => item.doc), ...favorites];
  const manySources = new Set(shown.map(doc => doc.sourceId)).size > 1;
  const sourceChanges = (docs: readonly Doc[], i: number) => manySources && docs[i - 1]?.sourceId !== docs[i].sourceId;

  function documentRow(doc: Doc, { timestamp, eventLabel, showSource, stackProvenance = false }: { timestamp?: string; eventLabel?: string; showSource: boolean; stackProvenance?: boolean }) {
    const key = keyOf(doc);
    const favorite = shortcuts.favorites.includes(key);
    const actions = actionsFor("row", { workspaceId, workspaceType: "PERSONAL", isPersonalOwner: access.isPersonalOwner, can: access.actions, confirmed,
      target: { ...doc, label: doc.title, favorite, revision: "CURRENT" },
    }).filter(action => action.id !== "document.move");
    const label = `${favorite ? "Remove favorite" : "Favorite"}: ${doc.title}`;
    return (
      <Row
        key={key}
        href={`/w/${workspaceId}/knowledge/${doc.sourceId}/${doc.documentId}`}
        icon={doc.pageIcon ? <span className="text-body leading-none" aria-hidden="true">{doc.pageIcon}</span> : <FileText size={14} aria-hidden="true" />}
        title={doc.title}
        timestamp={timestamp} eventLabel={eventLabel}
        provenance={[showSource ? doc.sourceName : undefined, doc.sourcePath].filter(Boolean).join(" · ")}
        stackProvenance={stackProvenance}
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

  function draftDestination(item: DraftItem) {
    if (!item.doc) return { href: `/w/${workspaceId}/knowledge/new?compose`, action: "Continue editing" };
    if (item.doc.status === "ACTIVE" && item.doc.sourceStatus === "ACTIVE" && item.doc.ownership === "HUB_MANAGED" && confirmed && access.actions.canWrite && access.workspace.lifecycleState !== "ARCHIVED") {
      return { href: `/w/${workspaceId}/knowledge/${item.doc.sourceId}/${item.doc.documentId}`, action: "Continue editing" };
    }
    return { href: `/w/${workspaceId}/knowledge/drafts/${item.doc.sourceId}/${item.doc.documentId}`, action: "Open draft" };
  }

  function draftProvenance(item: DraftItem): string | undefined {
    if (!item.doc) return undefined;
    if (item.doc.sourceStatus === "ARCHIVED") return "Draft · Source archived";
    if (item.doc.status === "ARCHIVED") return "Draft · Original document archived";
    return undefined;
  }

  // Invisible copies of a document row's preview, star and menu buttons, so what stands in their place lines up with
  // Recent's times at every control size.
  const slot = buttonClasses({ variant: "ghost", icon: true, size: "sm", className: "invisible" });
  const rowSlots = <span aria-hidden="true" className="mr-1 flex shrink-0"><span className={`${slot} hidden lg:inline-flex`} /><span className={slot} /><span className={slot} /></span>;

  function draftRow(item: DraftItem, i: number) {
    // Draft rows omit document actions; the slots align their times with Recent.
    const destination = draftDestination(item);
    // The latest draft says what opening it does and the key that does it; the arrow alone on a phone.
    const hint = i === 0 ? <span className="flex shrink-0 items-center gap-1.5 text-caption text-kh-text-secondary">
      <span className="hidden sm:inline">{destination.action}</span><Kbd className="hidden sm:inline-flex">R</Kbd><ArrowRight size={14} aria-hidden="true" />
    </span> : undefined;
    return <Row key={item.id} href={destination.href} icon={<PenLine size={14} aria-hidden="true" className="text-kh-selected-text" />} title={item.draft.title || "Untitled draft"} timestamp={item.at} provenance={draftProvenance(item)}
      hint={hint} keyShortcuts={i === 0 ? "R" : undefined}
      trailing={rowSlots} />;
  }

  const recentDocs = recentShown.map(item => item.doc);
  const recentRow = (item: RecentItem) => {
    const i = recentShown.indexOf(item);
    return documentRow(item.doc, { timestamp: item.at, eventLabel: item.label, showSource: sourceChanges(recentDocs, i) });
  };

  return (
    <GuidanceVisibilityContext.Provider value={{ dismissed, setDismissed }}>
    <div className="kh-page kh-home space-y-6 pb-6">
      <PageHeader
        location="My Space"
        locationHref={`/w/${workspaceId}/home`}
        title="Home"
        actions={<>
          <MenuRoot>
            <MenuTrigger aria-label="Home actions" className={buttonClasses({ variant: "ghost", icon: true })}><MoreHorizontal size={16} aria-hidden="true" /></MenuTrigger>
            <MenuContent align="end" className="w-72">
              {/* Only what the expanded rail does not offer; it lists Tasks only when compact. */}
              <MenuItem render={<Link href={`/w/${workspaceId}/tasks`} />}>Open Tasks</MenuItem>
              <MenuItem render={<Link href={`/w/${workspaceId}/agent-context`} />}>Copy for Agent</MenuItem>
              <ReopenGuidanceMenuItem workspaceId={workspaceId} />
              <MenuItem render={<a href={`/api/workspaces/${workspaceId}/export`} />}>Export Markdown ZIP</MenuItem>
              <p className="px-3 py-2 text-caption text-kh-text-muted">Export includes saved and archived notes. Drafts, history and attachments are excluded.</p>
            </MenuContent>
          </MenuRoot>
        </>}
      />
      {/* Opens the same ⌘K palette as the rail, so there is still one place to search. */}
      {/* WCAG 2.5.3: the badge is visible text in the field, so the name carries it too. The space
          before the badge is real: axe joins visible text nodes without one, and the name has to
          appear inside that run. A whitespace-only text node is not a flex item, so the field's
          layout is unchanged. */}
      <div className="flex items-center gap-3">
        <button type="button" data-home-search onClick={requestQuickSearch} aria-label="Search articles and notes ⌘K" aria-keyshortcuts="Meta+K Control+K" className="kh-focus-ring flex min-h-8 min-w-0 flex-1 items-center gap-3 rounded-md border border-kh-border px-3 py-1 text-body text-kh-text-muted hover:bg-kh-bg-subtle">
          <Search size={16} aria-hidden="true" />
          <span className="flex-1 truncate text-left">Search articles and notes</span>{" "}
          <Kbd size="md" className="hidden shrink-0 sm:inline-flex">⌘K</Kbd>
        </button>
        <Tooltip label="Create document" shortcut="C">
          <Link className={buttonClasses({ variant: "secondary" })} href={newNoteHref} onClick={(event) => { if (!plainClick(event)) return; bufferTyping(); }} aria-keyshortcuts="C"><Plus size={16} aria-hidden="true" />Create document</Link>
        </Tooltip>
      </div>
      {slots?.guidance}
      {/* Two columns when the page's own box has room (`kh-home-grid`, globals.css), not when the window does.
          `pt-2` on top of `space-y-6` sets the lists 32px under the search row, more than the 24px between groups. */}
      <div className="kh-home-grid -mx-3 grid gap-6 pt-2">
        <div className="min-w-0 space-y-6">
          {lists.drafts.length > 0 && <Section title="Drafts" count={lists.drafts.length}>
            <ul onKeyDown={navigateListRows} className="space-y-0.5">{lists.drafts.map(draftRow)}</ul>
          </Section>}
          <Section title="Recent">
            {!lists.recent.length ? <EmptyLine>Documents you edit or open will appear here.{activeDocumentCount === 0 && dismissed ? <ReopenGuidanceMenuItem workspaceId={workspaceId} surface="empty" /> : null}</EmptyLine>
              : now === null ? <ul onKeyDown={navigateListRows} className="space-y-0.5">{recentShown.map(recentRow)}</ul>
              : <div onKeyDown={navigateListRows}>{recentGroups(recentShown, now, zone).map((group, g) => (
                <div key={group.label}>
                  {/* The day belongs to the time column, not the titles: a hairline with a faint label at the right, so
                      it never reads as a heading. Today needs none at the top; every row already carries its time. */}
                  {g === 0 && group.label === "Today" ? <h3 className="sr-only">Today</h3>
                    : <h3 className="flex items-center pr-1 text-micro text-kh-text-faint">
                      <span className="flex min-w-0 flex-1 items-center gap-2 px-3 py-1"><span aria-hidden="true" className="h-px flex-1 bg-kh-border" />{group.label}</span>{rowSlots}
                    </h3>}
                  <ul className="space-y-0.5">{group.items.map(recentRow)}</ul>
                </div>
              ))}</div>}
            {hiddenRecent > 0 ? <Button variant="ghost" size="sm" className="mx-3 mt-1 text-kh-text-muted" aria-expanded={showAllRecent} onClick={() => setShowAllRecent(!showAllRecent)}>
              {showAllRecent ? "Show fewer" : `Show ${hiddenRecent} more`}
            </Button> : null}
          </Section>
        </div>
        <div className="min-w-0 space-y-6">
          {/* What waits for the reader first: reminders, then replies; Favorites are standing shortcuts. */}
          <AttentionList workspaceId={workspaceId} reminders={reminders} />
          <Section title="Discussions" count={notices.length} action={{ href: `/w/${workspaceId}/inbox`, label: "Open Inbox" }}>
            {notices.length ? <UnreadDiscussions notices={notices} /> : <EmptyLine>No new comments or replies.</EmptyLine>}
          </Section>
          <Section title="Favorites">
            {favorites.length ? <ul onKeyDown={navigateListRows} className="space-y-0.5">{favorites.map((doc, i) => documentRow(doc, { showSource: sourceChanges(favorites, i), stackProvenance: true }))}</ul>
              : <EmptyLine>Star a document to keep it here.</EmptyLine>}
          </Section>
        </div>
      </div>
    </div>
    </GuidanceVisibilityContext.Provider>
  );
}

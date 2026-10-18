"use client";

import { GuidanceVisibilityContext } from "./guidance-visibility";
import { ReopenGuidanceMenuItem } from "./reopen-guidance-menu-item";
import { Fragment, useState, type ReactNode } from "react";
import { HomeUpdates } from "./home-updates";
import { HomeDiscussionsContent, useHomeDiscussions } from "./home-discussions";
import type {FolderUpdatesPage} from "@/modules/personal/application/list-folder-updates";

import Link from "next/link";
import { FileText, PenLine, Star, MoreHorizontal, Search, Plus } from "lucide-react";
import { navigateListRows } from "@/lib/list-row-navigation";
import { useDocumentShortcuts, documentShortcutKey } from "./use-document-shortcuts";
import { toggleFavoriteDocument } from "@/lib/document-shortcuts";
import { Button, buttonClasses } from "@/components/ui/button";
import { PageHeader } from "@/components/shell/page-header";
import { requestQuickSearch } from "@/components/search/search-nav-item";
import { Timestamp } from "@/components/ui/timestamp";
import { Tooltip } from "@/components/ui/tooltip";
import { actionsFor, type Action } from "@/components/actions/action-registry";
import { RowActionsTrigger, RowContextMenu, useActionRunner } from "@/components/actions/action-menu";
import { useWorkspaceAuthorization } from "@/components/shell/use-workspace-authorization";
import { MenuRoot, MenuTrigger, MenuContent, MenuItem } from "@/components/ui/menu";
import { ShareLinkDialogHost } from "./share-link-dialog";
import { useHydrated } from "@/components/shell/use-hydrated";

type Doc = { sourceName?:string; sourcePath?:string|null; documentId: string; sourceId: string; title: string; updatedAt: string; ownership: "SOURCE_MANAGED" | "HUB_MANAGED"; status: "ACTIVE" | "ARCHIVED"; sourceStatus: "ACTIVE" | "ARCHIVED" };
type Draft = { key: string; title: string; sourceId: string | null; updatedAt: string };

/** Keep task groups visually clear without adding card chrome. */
function Section({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section aria-label={title} className={`min-w-0 ${className}`}>
      <h2 className="px-3 pb-3 text-body font-medium text-kh-text">{title}</h2>
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
function Row({ href, icon, title, timestamp, timeLabel, provenance, trailing, actions = [], onRun = () => {} }: {
  href: string;
  icon: React.ReactNode;
  title: string;
  timestamp?: string;
  timeLabel?: string;
  provenance?:string;
  trailing?: React.ReactNode;
  actions?: readonly Action[];
  onRun?: (action: Action) => void;
}) {
  return (
    <RowContextMenu actions={actions} onRun={onRun} className="kh-interactive-row group flex min-h-10 items-center pr-1">
      <Link
        data-list-row
        href={href}
        className="kh-focus-ring flex min-h-10 min-w-0 flex-1 items-center gap-3 rounded-md px-3"
      >
        <span className="shrink-0 text-kh-text-muted">{icon}</span>
        <span className="min-w-0 flex-1 py-1">
          <span className="block truncate text-body font-medium text-kh-text">{title}</span>
          {provenance?<span className="block truncate text-caption text-kh-text-muted">{provenance}</span>:null}
          {timestamp ? <span className="block text-caption text-kh-text-muted sm:hidden">{timeLabel} <Timestamp value={timestamp} variant="relative" /></span> : null}
        </span>
        {timestamp ? <span data-home-activity className="hidden w-36 shrink-0 grid-cols-[3rem_minmax(0,1fr)] items-baseline gap-2 whitespace-nowrap text-caption text-kh-text-muted sm:grid">
          <span>{timeLabel}</span>
          <span className="text-right tabular-nums"><Timestamp value={timestamp} variant="relative" /></span>
        </span> : null}
      </Link>
      <div data-home-actions className="grid w-14 shrink-0 grid-cols-2 items-center">
        <span className="flex h-6 items-center justify-center">{trailing}</span>
        <span className="flex h-6 items-center justify-center"><RowActionsTrigger actions={actions} onRun={onRun} label={title} className="kh-row-action" /></span>
      </div>
    </RowContextMenu>
  );
}

export function PersonalHome({ workspaceId, documents, drafts, updates={runs:[],nextCursor:null}, slots, guidanceDismissed = false }: { guidanceDismissed?: boolean; slots?: { guidance?: ReactNode; reminders?: ReactNode }; workspaceId: string; documents: Doc[]; drafts: Draft[]; updates?:FolderUpdatesPage }) {
  const [dismissed, setDismissed] = useState(guidanceDismissed);
  const { shortcuts, update } = useDocumentShortcuts(workspaceId);
  const discussions = useHomeDiscussions(workspaceId);
  const showDiscussionPanel = discussions.status !== "ready" || discussions.notices.length > 0;
  const hydrated = useHydrated();
  const { access, confirmed } = useWorkspaceAuthorization();
  const runAction = useActionRunner({ onToggleFavorite: (sourceId, documentId) => update(state => toggleFavoriteDocument(state, documentShortcutKey(sourceId, documentId))) });
  const keyOf = (doc: Doc) => documentShortcutKey(doc.sourceId, doc.documentId);
  const active = documents.filter(doc => doc.status === "ACTIVE" && doc.sourceStatus === "ACTIVE");
  const favorites = shortcuts.favorites.flatMap(key => active.filter(doc => keyOf(doc) === key));
  const resumeDrafts = drafts.filter(draft => draft.key === "draft:new" || active.some(doc => doc.documentId === draft.key.split(":")[1]));
  const draftIds = new Set(resumeDrafts.map(draft => draft.key.split(":")[1]));
  const activityAt = (doc: Doc) => [doc.ownership === "HUB_MANAGED" ? doc.updatedAt : "", shortcuts.openedAt?.[keyOf(doc)] ?? ""].sort().at(-1) ?? "";
  const continuing = [
    ...active.filter(doc => !draftIds.has(doc.documentId) && (doc.ownership === "HUB_MANAGED" || shortcuts.recent.includes(keyOf(doc))))
      .map(doc => ({ doc, draft: null, timestamp: activityAt(doc) })),
    ...resumeDrafts.map(draft => ({ doc: null, draft, timestamp: draft.updatedAt })),
  ].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  const [showAllWork, setShowAllWork] = useState(false);
  const [showAllFavorites, setShowAllFavorites] = useState(false);
  const latestDraft = continuing.find(item => item.draft !== null);
  const visibleContinuing = (showAllWork ? continuing.slice(0, 12) : continuing.slice(0, 6));
  if (latestDraft && !visibleContinuing.includes(latestDraft)) {
    visibleContinuing[visibleContinuing.length - 1] = latestDraft;
  }

  function documentRows(docs: Doc[], showActivity = true) {
    return (
      <>
        {docs.map((doc) => {
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
              timestamp={showActivity ? activityAt(doc) : undefined}
              timeLabel={(shortcuts.openedAt?.[key] ?? "") >= doc.updatedAt || doc.ownership !== "HUB_MANAGED" ? "Opened" : "Updated"}
              provenance={[doc.sourceName,doc.sourcePath].filter(Boolean).join(" · ")}
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
        })}
      </>
    );
  }

  return (
    <GuidanceVisibilityContext.Provider value={{ dismissed, setDismissed }}>
    <div className="kh-page space-y-6 pb-6">
      <PageHeader
        location="My Space"
        locationHref={`/w/${workspaceId}/home`}
        title="Home"
        actions={<>
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
      <div className="flex items-center gap-3">
        <button type="button" onClick={requestQuickSearch} className="kh-focus-ring flex min-h-10 min-w-0 flex-1 items-center gap-3 rounded-md border border-kh-border px-3 py-2 text-body text-kh-text-muted hover:bg-kh-bg-hover" aria-label="Search articles and notes">
          <Search size={16} aria-hidden="true" />
          <span className="flex-1 truncate text-left">Search articles and notes…</span>
          <span className="hidden text-caption sm:inline" aria-hidden="true">⌘K</span>
        </button>
        <Link className={buttonClasses({ variant: "secondary", size: "lg" })} href={`/w/${workspaceId}/knowledge/new`}><Plus size={16} aria-hidden="true" />New note</Link>
      </div>
      {slots?.guidance}
      <div className="-mx-3 grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Section title="Continue working" className="xl:col-start-1 xl:row-start-1">
          {continuing.length ? <ul onKeyDown={navigateListRows} className="space-y-1">
            {visibleContinuing.map(item => item.doc ? (
              <Fragment key={keyOf(item.doc)}>{documentRows([item.doc])}</Fragment>
            ) : item.draft ? (
              <Row key={item.draft.key}
                href={item.draft.key === "draft:new" ? `/w/${workspaceId}/knowledge/new` : `/w/${workspaceId}/knowledge/${item.draft.sourceId}/${item.draft.key.split(":")[1]}/edit`}
                icon={<PenLine size={14} aria-hidden="true" />}
                title={item.draft.title || "Untitled note"} provenance="Continue writing" timestamp={item.draft.updatedAt} timeLabel="Edited"
              />
            ) : null)}
          </ul> : <EmptyLine>Notes you write and documents you open will appear here.{documents.length === 0 && dismissed ? <ReopenGuidanceMenuItem workspaceId={workspaceId} surface="empty" /> : null}</EmptyLine>}
          <div className="mt-3 flex flex-wrap items-center gap-3 px-3">
            {continuing.length > 6 ? <Button variant="ghost" size="sm" onClick={() => setShowAllWork(!showAllWork)}>{showAllWork ? "Show fewer" : `Show more recent work (${Math.min(12, continuing.length)} of ${continuing.length})`}</Button> : null}
            <Link className="kh-focus-ring rounded-md py-2 text-body-sm text-kh-link" href={`/w/${workspaceId}/knowledge`}>Browse knowledge</Link>
          </div>
        </Section>
        {showDiscussionPanel ? <div className="min-w-0 xl:col-start-2 xl:row-span-2 xl:row-start-1">
          <HomeDiscussionsContent workspaceId={workspaceId} state={discussions} />
        </div> : null}
        <Section title="Favorites" className="xl:col-start-1 xl:row-start-2">
          {favorites.length ? <ul onKeyDown={navigateListRows} className="space-y-1">{documentRows(showAllFavorites ? favorites : favorites.slice(0, 6), false)}</ul> : <EmptyLine>Star documents to keep them close at hand.</EmptyLine>}
          {favorites.length > 6 ? <Button variant="ghost" size="sm" className="mx-3 mt-3" onClick={() => setShowAllFavorites(!showAllFavorites)}>{showAllFavorites ? "Show fewer favorites" : `Show all favorites (${favorites.length})`}</Button> : null}
        </Section>
        {!showDiscussionPanel ? <div className="min-w-0 xl:col-span-2 xl:row-start-3">
          <HomeDiscussionsContent workspaceId={workspaceId} state={discussions} compact />
        </div> : null}
        <Section title="Knowledge updates" className={`xl:col-span-2 ${showDiscussionPanel ? "xl:row-start-3" : "xl:row-start-4"}`}>
          {slots?.reminders}
          <HomeUpdates workspaceId={workspaceId} page={updates} />
          <Link className="kh-focus-ring mt-3 inline-block rounded-md px-3 py-2 text-body-sm text-kh-link" href={`/w/${workspaceId}/updates`}>View all folder updates</Link>
        </Section>
      </div>
      <ShareLinkDialogHost />
    </div>
    </GuidanceVisibilityContext.Provider>
  );
}

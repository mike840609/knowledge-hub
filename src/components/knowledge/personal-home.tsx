"use client";

import { ReopenGuidanceMenuItem } from "./reopen-guidance-menu-item";
import { useState, type ReactNode } from "react";
import { HomeUpdates } from "./home-updates";
import type {FolderUpdatesPage} from "@/modules/personal/application/list-folder-updates";

import Link from "next/link";
import { FileText, PenLine, Star, MoreHorizontal } from "lucide-react";
import { navigateListRows } from "@/lib/list-row-navigation";
import { useDocumentShortcuts, documentShortcutKey } from "./use-document-shortcuts";
import { toggleFavoriteDocument } from "@/lib/document-shortcuts";
import { Button, buttonClasses } from "@/components/ui/button";
import { PageHeader } from "@/components/shell/page-header";
import { TabsList, TabsPanel, TabsRoot, TabsTab } from "@/components/ui/tabs";
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

/** Keep the two work areas visually clear without adding card chrome. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="min-w-0">
      <h2 className="px-3 pb-3 text-body font-semibold text-kh-text">{title}</h2>
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
        {timestamp ? <span className="hidden shrink-0 text-caption text-kh-text-muted sm:block">{timeLabel} <Timestamp value={timestamp} variant="relative" /></span> : null}
      </Link>
      {trailing}
      <RowActionsTrigger actions={actions} onRun={onRun} label={title} className="kh-row-action mr-1" />
    </RowContextMenu>
  );
}

export function PersonalHome({ workspaceId, documents, drafts, updates={runs:[],nextCursor:null}, slots }: { slots?: { guidance?: ReactNode; reminders?: ReactNode }; workspaceId: string; documents: Doc[]; drafts: Draft[]; updates?:FolderUpdatesPage }) {
  const { shortcuts, update } = useDocumentShortcuts(workspaceId);
  const hydrated = useHydrated();
  const { access, confirmed } = useWorkspaceAuthorization();
  const runAction = useActionRunner({ onToggleFavorite: (sourceId, documentId) => update(state => toggleFavoriteDocument(state, documentShortcutKey(sourceId, documentId))) });
  const keyOf = (doc: Doc) => documentShortcutKey(doc.sourceId, doc.documentId);
  const recent = shortcuts.recent
    .map((key) => documents.find((doc) => keyOf(doc) === key))
    .filter((doc): doc is Doc => !!doc && doc.status === "ACTIVE" && doc.sourceStatus === "ACTIVE");
  const [workTab, setWorkTab] = useState("recent");
  const resumeDrafts = [...drafts].sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));

  function documentRows(docs: Doc[]) {
    return (
      <ul onKeyDown={navigateListRows} className="space-y-0.5">
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
              timestamp={shortcuts.openedAt?.[key]} timeLabel="Opened"
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
      </ul>
    );
  }

  return (
    <div className="kh-page space-y-6 py-6">
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
      <p className="px-3 text-caption text-kh-text-muted">Need help? <Link className="kh-focus-ring rounded-md text-kh-link hover:underline" href={`/w/${workspaceId}/help#quick-start`}>Quick start guide</Link></p>
      {slots?.guidance}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Section title="Continue reading">
          <TabsRoot value={workTab} onValueChange={value => setWorkTab(String(value))}>
            <TabsList aria-label="Continue working" className="mx-3">
              <TabsTab value="recent" className="aria-selected:border-kh-primary aria-selected:text-kh-selected-text">Recent reading</TabsTab>
              <TabsTab value="drafts" className="aria-selected:border-kh-primary aria-selected:text-kh-selected-text">Drafts{drafts.length > 0 ? ` ${drafts.length}` : ""}</TabsTab>
            </TabsList>
            <TabsPanel value="recent">
              {recent.length > 0 ? documentRows(recent.slice(0, 5)) : <EmptyLine>Documents you open will appear here.</EmptyLine>}
            </TabsPanel>
            <TabsPanel value="drafts">
              {resumeDrafts.length > 0 ? <ul onKeyDown={navigateListRows} className="space-y-0.5">
                {resumeDrafts.map(draft => <Row key={draft.key}
                  href={draft.key === "draft:new" ? `/w/${workspaceId}/knowledge/new` : `/w/${workspaceId}/knowledge/${draft.sourceId}/${draft.key.split(":")[1]}/edit`}
                  icon={<PenLine size={14} aria-hidden="true" />}
                  title={draft.title || "Untitled draft"} provenance="Draft · Continue writing" timestamp={draft.updatedAt} timeLabel="Edited"
                />)}
              </ul> : <EmptyLine>No unfinished drafts.</EmptyLine>}
            </TabsPanel>
          </TabsRoot>
          <Link className="kh-focus-ring mt-3 inline-block rounded-md px-3 py-2 text-body-sm text-kh-link" href={`/w/${workspaceId}/knowledge`}>Browse knowledge</Link>
        </Section>
        <Section title="Updates">
          {slots?.reminders}
          <HomeUpdates workspaceId={workspaceId} page={updates} />
          <Link className="kh-focus-ring mt-3 inline-block rounded-md px-3 py-2 text-body-sm text-kh-link" href={`/w/${workspaceId}/updates`}>View all updates</Link>
        </Section>
      </div>
      <ShareLinkDialogHost />
    </div>
  );
}

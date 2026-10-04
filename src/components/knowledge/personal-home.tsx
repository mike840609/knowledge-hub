"use client";
import {PersonalStatsSummary} from "@/components/personal/personal-stats-summary";
import type {ProfileCounts} from "@/modules/personal/domain/personal-profile";
import {Input} from "@/components/ui/input";
import type { FolderImportClientLimits } from "@/components/imports/folder-import-form";
import {HomeFolderList} from "./home-folder-list";
import {UpdatesList} from "./updates-list";
import {WorkspaceImportLink} from "@/components/shell/workspace-import-link";
import type {SourceListItemModel} from "@/server/source-read";
import type {FolderUpdatesPage} from "@/modules/personal/application/list-folder-updates";

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

type Doc = { sourceName?:string; sourcePath?:string|null; documentId: string; sourceId: string; title: string; updatedAt: string; ownership: "SOURCE_MANAGED" | "HUB_MANAGED"; status: "ACTIVE" | "ARCHIVED"; sourceStatus: "ACTIVE" | "ARCHIVED" };
type Draft = { key: string; title: string; sourceId: string | null; updatedAt: string };

/**
 * A group on this page is a label and a list of rows, nothing between them.
 * The label is the one style the rails use for theirs (§8): `caption`, medium,
 * `text-muted`, so a heading never competes with the rows beneath it.
 */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title}>
      <h2 className="px-3 pb-1 text-caption font-medium text-kh-text-muted">{title}</h2>
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
function Row({ href, icon, title, updatedAt, provenance, trailing, actions = [], onRun = () => {} }: {
  href: string;
  icon: React.ReactNode;
  title: string;
  updatedAt: string;
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
          <Timestamp value={updatedAt} variant="date" className="block text-caption text-kh-text-muted sm:hidden" />
        </span>
        <Timestamp value={updatedAt} variant="date" className="hidden shrink-0 text-caption text-kh-text-muted sm:block" />
      </Link>
      {trailing}
      <RowActionsTrigger actions={actions} onRun={onRun} label={title} className="kh-row-action mr-1" />
    </RowContextMenu>
  );
}

export function PersonalHome({ workspaceId, documents, drafts, limits, profileCounts, folders=[], updates={runs:[],nextCursor:null} }: { workspaceId: string; profileCounts?:ProfileCounts; documents: Doc[]; drafts: Draft[];limits?:FolderImportClientLimits;folders?:SourceListItemModel[];updates?:FolderUpdatesPage }) {
  const { shortcuts, update } = useDocumentShortcuts(workspaceId);
  const hydrated = useHydrated();
  const { access, confirmed } = useWorkspaceAuthorization();
  const runAction = useActionRunner({ onToggleFavorite: (sourceId, documentId) => update(state => toggleFavoriteDocument(state, documentShortcutKey(sourceId, documentId))) });
  const keyOf = (doc: Doc) => documentShortcutKey(doc.sourceId, doc.documentId);
  const favorites = documents.filter((doc) => shortcuts.favorites.includes(keyOf(doc)));
  const recent = shortcuts.recent
    .map((key) => documents.find((doc) => keyOf(doc) === key))
    .filter((doc): doc is Doc => !!doc);

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
              updatedAt={doc.updatedAt}
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
        description="Find knowledge, check your folders, and continue reading."
        actions={<>
          <Link className={buttonClasses({ variant: "secondary" })} href={`/w/${workspaceId}/agent-context`}>Copy for Agent</Link>
          <MenuRoot>
            <MenuTrigger aria-label="Home actions" className={buttonClasses({ variant: "ghost", icon: true })}><MoreHorizontal size={16} aria-hidden="true" /></MenuTrigger>
            <MenuContent align="end" className="w-72">
              <MenuItem render={<Link href={`/w/${workspaceId}/knowledge`} />}>Organize documents</MenuItem>
              <MenuItem render={<a href={`/api/workspaces/${workspaceId}/export`} />}>Export Markdown ZIP</MenuItem>
              <p className="px-3 py-2 text-caption text-kh-text-muted">Export includes saved and archived notes. Drafts, history and attachments are excluded.</p>
            </MenuContent>
          </MenuRoot>
          <WorkspaceImportLink className={buttonClasses()} href={`/w/${workspaceId}/sources/import`}>Import folder</WorkspaceImportLink>
        </>}
      />
      {profileCounts?<PersonalStatsSummary workspaceId={workspaceId} counts={profileCounts}/>:null}
      <form action={`/w/${workspaceId}/search`} role="search" className="px-3">
        <label className="sr-only" htmlFor="my-space-search">Search My Space</label>
        <div className="flex gap-2"><Input id="my-space-search" name="q" placeholder="Search your knowledge…" className="min-w-0 flex-1"/><Input type="hidden" name="scope" value="workspace"/><button className={buttonClasses({variant:"secondary"})}>Search</button></div>
      </form>
      <Section title="My folders"><HomeFolderList workspaceId={workspaceId} items={folders} limits={limits}/><Link className="block px-3 pt-2 text-caption text-kh-link" href={`/w/${workspaceId}/sources`}>Manage sources</Link></Section>
      {recent.length > 0 && <Section title="Continue reading">{documentRows(recent.slice(0, 4))}</Section>}
      <Section title="Updates"><UpdatesList workspaceId={workspaceId} page={updates}/><Link className="block px-3 pt-2 text-caption text-kh-link" href={`/w/${workspaceId}/updates`}>View all updates</Link></Section>
      {favorites.length > 0 ? <Section title="Favorites">
        {documentRows(favorites)}
      </Section> : null}
            {drafts.length > 0 ? <Section title="Drafts">
        <ul onKeyDown={navigateListRows} className="space-y-0.5">
            {drafts.map((draft) => (
              <Row
                key={draft.key}
                href={draft.key === "draft:new"
                  ? `/w/${workspaceId}/knowledge/new`
                  : `/w/${workspaceId}/knowledge/${draft.sourceId}/${draft.key.split(":")[1]}/edit`}
                icon={<PenLine size={14} aria-hidden="true" />}
                title={draft.title || "Untitled draft"}
                updatedAt={draft.updatedAt}
              />
            ))}
          </ul>
      </Section> : null}
      <Section title="Your notes"><Link className="block px-3 py-2 text-caption text-kh-link" href={`/w/${workspaceId}/knowledge/new`}>New note</Link>
        {documents.some(d=>d.ownership==="HUB_MANAGED") ? documentRows(documents.filter(d=>d.ownership==="HUB_MANAGED").slice(0, 12)) : (
          <EmptyLine>
            Create your first note or <Link className="rounded-md text-kh-link underline underline-offset-2 kh-focus-ring" href={`/w/${workspaceId}/sources/import`}>import a folder</Link>.
          </EmptyLine>
        )}
      </Section>
      <ShareLinkDialogHost />
    </div>
  );
}

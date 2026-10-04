"use client";
import Link from "next/link";
import type { SourceListItemModel } from "@/server/source-read";
import type { FolderImportClientLimits } from "@/components/imports/folder-import-form";
import { SourceList } from "@/components/sources/source-list";
import { WorkspaceImportLink } from "@/components/shell/workspace-import-link";
import { buttonClasses } from "@/components/ui/button";

export function PersonalSyncOverview({ workspaceId, items, limits }: { workspaceId: string; items: SourceListItemModel[]; limits?: FolderImportClientLimits }) {
  const folders = items.filter(item => item.source.sourceType === "FOLDER_SYNC" && item.source.status === "ACTIVE");
  return <section aria-label="Synced folders" className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2 px-3">
      <h2 className="text-caption font-medium text-kh-text-muted">Synced folders</h2>
      <WorkspaceImportLink className={buttonClasses({variant:"secondary"})} href={`/w/${workspaceId}/sources/import`}>Import Markdown folder</WorkspaceImportLink>
    </div>
    {folders.length > 0 ? <SourceList workspaceId={workspaceId} items={folders} limits={limits} /> : <p className="px-3 text-body text-kh-text-muted">Bring your local LLM Wiki or Obsidian Markdown folder into My Space.</p>}
    <p className="px-3 text-caption text-kh-text-muted">Your local folder is the source of truth. Edit locally, sync, review the Preview, then select Apply to publish changes. Sync does not run automatically.</p>
    {folders.length > 0 ? <Link className="kh-focus-ring mx-3 inline-block rounded-md text-caption text-kh-link underline underline-offset-2" href={`/w/${workspaceId}/sources`}>Manage sources and sync history</Link> : null}
  </section>;
}

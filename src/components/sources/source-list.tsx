"use client";
import { useState } from "react";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import type { FolderImportClientLimits } from "@/components/imports/folder-import-form";
import { navigateListRows } from "@/lib/list-row-navigation";
import { Database } from "lucide-react";
import type { SourceListItemModel } from "@/server/source-read";
import { SourceListRow } from "@/components/sources/source-list-row";
import { WorkspaceImportLink } from "@/components/shell/workspace-import-link";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export function SourceList({ workspaceId, items, limits }: { workspaceId: string; items: SourceListItemModel[]; limits?: FolderImportClientLimits }) {
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [sort, setSort] = useState("attention");
  const needsAttention = (item: SourceListItemModel) => !!item.pendingPreviewId || item.latestRun?.status === "FAILED";
  const attentionCount = items.filter(needsAttention).length;
  const visible = items.filter(item => !attentionOnly || needsAttention(item)).sort((a,b) => {
    if (sort === "attention") return Number(needsAttention(b)) - Number(needsAttention(a)) || a.source.name.localeCompare(b.source.name);
    if (sort === "recent") return (b.latestSuccessfulRun?.completedAt?.getTime() ?? 0) - (a.latestSuccessfulRun?.completedAt?.getTime() ?? 0) || a.source.name.localeCompare(b.source.name);
    return a.source.name.localeCompare(b.source.name);
  });
  if (items.length === 0) {
    return (
      <EmptyState
        icon={Database}
        title="No sources yet"
        description="A source is a folder of Markdown the Hub keeps in sync. Import one and its documents appear in Knowledge."
        action={
          // Absent for a reader who cannot import, rather than a button that would be refused.
          <WorkspaceImportLink
            className={buttonClasses({ variant: "primary" })}
            href={`/w/${workspaceId}/sources/import`}
          >
            Import folder
          </WorkspaceImportLink>
        }
      />
    );
  }
  return (
    <div className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-kh-border pb-3">
      <label className="flex min-h-8 items-center gap-2 text-body-sm"><input className="kh-focus-ring accent-kh-primary" type="checkbox" checked={attentionOnly} onChange={e => setAttentionOnly(e.target.checked)} />Needs attention ({attentionCount})</label>
      <label className="flex items-center gap-2 text-caption text-kh-text-muted">Sort sources<Select aria-label="Sort sources" value={sort} onChange={e => setSort(e.target.value)}><option value="attention">Attention first</option><option value="name">Name</option><option value="recent">Last successful sync</option></Select></label>
    </div>
    <p role="status" className="text-caption text-kh-text-muted">{visible.length} of {items.length} sources{attentionOnly ? " · failed sync or awaiting Apply" : ""}</p>
    {!visible.length ? <div className="space-y-2"><p className="text-body text-kh-text-muted">No sources need attention.</p><Button variant="ghost" size="sm" onClick={() => setAttentionOnly(false)}>Show all sources</Button></div> : null}
    <ul onKeyDown={navigateListRows} className="flex flex-col gap-1">
      {visible.map((item) => (
        <SourceListRow key={item.source.id} workspaceId={workspaceId} item={item} limits={limits} />
      ))}
    </ul>
    </div>
  );
}

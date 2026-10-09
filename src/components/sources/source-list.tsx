"use client";
import { WorkspaceEmptyIllustration } from "@/components/knowledge/workspace-empty-illustration";

import { useWorkspaceAuthorization } from "@/components/shell/use-workspace-authorization";
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
  const { access, confirmed } = useWorkspaceAuthorization();
  const accessConfirmed = confirmed && access.workspace.id === workspaceId;
  const canImport = accessConfirmed && access.actions.canImport;
  const [showArchived, setShowArchived] = useState(false);
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [sort, setSort] = useState("attention");
  const needsAttention = (item: SourceListItemModel) => !!item.pendingPreviewId || item.latestRun?.status === "FAILED";
  const attentionCount = items.filter(needsAttention).length;
  const visible = items.filter(item => (showArchived || item.source.status === "ACTIVE") && (!attentionOnly || needsAttention(item))).sort((a,b) => {
    if (sort === "attention") return Number(needsAttention(b)) - Number(needsAttention(a)) || a.source.name.localeCompare(b.source.name);
    if (sort === "recent") return (b.latestSuccessfulRun?.completedAt?.getTime() ?? 0) - (a.latestSuccessfulRun?.completedAt?.getTime() ?? 0) || a.source.name.localeCompare(b.source.name);
    return a.source.name.localeCompare(b.source.name);
  });
  if (items.length === 0) {
    return (
      <EmptyState
        icon={Database} illustration={<WorkspaceEmptyIllustration kind="sources" />}
        title="No sources yet"
        description={!accessConfirmed ? "Checking workspace access…" : canImport ? "A source is a folder of Markdown the Hub keeps in sync. Import one and its documents appear in Knowledge." : access.workspace.lifecycleState === "ARCHIVED" ? "This workspace is archived. Ask a workspace owner to restore it before importing a folder." : "A source is a folder of Markdown the Hub keeps in sync. Ask a member with import access to add a folder; its documents will appear in Knowledge."}
        action={canImport ? (
          <WorkspaceImportLink
            className={buttonClasses({ variant: "primary" })}
            href={`/w/${workspaceId}/sources/import`}
          >
            Import folder
          </WorkspaceImportLink>
        ) : undefined}
      />
    );
  }
  return (
    <div className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-kh-border pb-3">
      <label className="flex min-h-8 items-center gap-2 text-body-sm"><input className="kh-focus-ring accent-kh-primary" type="checkbox" checked={attentionOnly} onChange={e => setAttentionOnly(e.target.checked)} />Needs attention ({attentionCount})</label>
    <label className="flex items-center gap-2 text-body-sm"><input type="checkbox" className="kh-focus-ring accent-kh-primary" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />Show archived</label>
      <label className="flex items-center gap-2 text-caption text-kh-text-muted">Sort sources<Select aria-label="Sort sources" value={sort} onChange={e => setSort(e.target.value)}><option value="attention">Attention first</option><option value="name">Name</option><option value="recent">Last successful sync</option></Select></label>
    </div>
    <p role="status" className="text-caption text-kh-text-muted">{visible.length} of {items.length} sources{attentionOnly ? " · failed sync or awaiting Apply" : ""}</p>
    {!visible.length ? <div className="space-y-2"><p className="text-body text-kh-text-muted">No sources match these filters.</p>{attentionOnly ? <Button variant="ghost" size="sm" onClick={() => setAttentionOnly(false)}>Show all sources</Button> : null}</div> : null}
    <ul onKeyDown={navigateListRows} className="flex flex-col gap-1">
      {visible.map((item) => (
        <SourceListRow key={item.source.id} workspaceId={workspaceId} item={item} limits={limits} />
      ))}
    </ul>
    </div>
  );
}

"use client";
import { navigateListRows } from "@/lib/list-row-navigation";
import { Database } from "lucide-react";
import type { SourceListItemModel } from "@/server/source-read";
import { SourceListRow } from "@/components/sources/source-list-row";
import { WorkspaceImportLink } from "@/components/shell/workspace-import-link";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export function SourceList({ workspaceId, items }: { workspaceId: string; items: SourceListItemModel[] }) {
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
    <ul onKeyDown={navigateListRows} className="flex flex-col gap-1">
      {items.map((item) => (
        <SourceListRow key={item.source.id} workspaceId={workspaceId} item={item} />
      ))}
    </ul>
  );
}

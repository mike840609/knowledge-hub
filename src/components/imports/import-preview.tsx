"use client";

import { useMemo } from "react";
import type { ImportPreview } from "@/modules/sources/application/reconcile-import-snapshot";
import type { ImportPreviewChange } from "@/modules/sources/domain/import-plan";
import { ImportChangeGroup } from "@/components/imports/import-change-group";
import { ImportStickyFooter } from "@/components/imports/import-sticky-footer";
import { ImportSummary } from "@/components/imports/import-summary";
import { ImportWarningSummary } from "@/components/imports/import-warning-summary";

type ChangeGroupKey = "added" | "updated" | "moved" | "archived" | "unchanged";

const GROUP_META: { key: ChangeGroupKey; title: string }[] = [
  { key: "added", title: "Added" },
  { key: "updated", title: "Updated" },
  { key: "moved", title: "Moved / Renamed" },
  { key: "archived", title: "Archived / Restored" },
  { key: "unchanged", title: "Unchanged" },
];

function groupOf(change: ImportPreviewChange): ChangeGroupKey {
  const labels = new Set(change.labels);
  if (labels.has("MOVED") || labels.has("RENAMED")) return "moved";
  if (labels.has("ADDED")) return "added";
  if (labels.has("UPDATED")) return "updated";
  if (labels.has("ARCHIVED") || labels.has("RESTORED") || labels.has("REMOVED")) return "archived";
  return "unchanged";
}

export function ImportPreview({
  workspaceId,
  preview,
}: {
  workspaceId: string;
  preview: ImportPreview;
}): React.JSX.Element {
  const groups = useMemo(() => {
    const grouped: Record<ChangeGroupKey, ImportPreviewChange[]> = {
      added: [],
      updated: [],
      moved: [],
      archived: [],
      unchanged: [],
    };
    for (const change of preview.changes) grouped[groupOf(change)].push(change);
    return grouped;
  }, [preview.changes]);

  return (
    <div className="flex flex-col gap-4 pb-6">
      <ImportSummary preview={preview} />
      <ImportWarningSummary preview={preview} />
      {GROUP_META.map((group) => (
        <ImportChangeGroup
          key={group.key}
          title={group.title}
          changes={groups[group.key]}
          defaultExpanded={group.key !== "unchanged"}
        />
      ))}
      <ImportStickyFooter workspaceId={workspaceId} preview={preview} />
    </div>
  );
}

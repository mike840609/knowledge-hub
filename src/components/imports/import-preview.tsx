"use client";

import { useMemo, useState } from "react";
import type { ImportPreview } from "@/modules/sources/application/reconcile-import-snapshot";
import type { ImportPreviewChange } from "@/modules/sources/domain/import-plan";
import { ImportChangeGroup } from "@/components/imports/import-change-group";
import { ImportStickyFooter } from "@/components/imports/import-sticky-footer";
import { ImportSummary } from "@/components/imports/import-summary";
import { ImportWarningSummary } from "@/components/imports/import-warning-summary";

type ChangeGroupKey = "added" | "updated" | "moved" | "archived" | "unchanged";

type ChangeFilter = "all" | "added" | "updated" | "moved" | "renamed" | "archived" | "warnings";

const GROUP_META: { key: ChangeGroupKey; title: string }[] = [
  { key: "added", title: "Added" },
  { key: "updated", title: "Updated" },
  { key: "moved", title: "Moved / Renamed" },
  { key: "archived", title: "Archived / Restored" },
  { key: "unchanged", title: "Unchanged" },
];

const FILTER_META: { value: ChangeFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "added", label: "Added" },
  { value: "updated", label: "Updated" },
  { value: "moved", label: "Moved" },
  { value: "renamed", label: "Renamed" },
  { value: "archived", label: "Archived" },
  { value: "warnings", label: "Warnings" },
];

function groupOf(change: ImportPreviewChange): ChangeGroupKey {
  const labels = new Set(change.labels);
  if (labels.has("MOVED") || labels.has("RENAMED")) return "moved";
  if (labels.has("ADDED")) return "added";
  if (labels.has("UPDATED")) return "updated";
  if (labels.has("ARCHIVED") || labels.has("RESTORED") || labels.has("REMOVED")) return "archived";
  return "unchanged";
}

function matchesFilter(change: ImportPreviewChange, filter: ChangeFilter): boolean {
  if (filter === "all") return true;
  if (filter === "warnings") return change.diagnostics.length > 0;
  if (filter === "moved" || filter === "renamed") {
    return new Set(change.labels).has(filter === "moved" ? "MOVED" : "RENAMED");
  }
  return groupOf(change) === filter;
}

function countFor(changes: readonly ImportPreviewChange[], filter: ChangeFilter): number {
  return changes.filter((change) => matchesFilter(change, filter)).length;
}

export function ImportPreview({
  workspaceId,
  preview,
}: {
  workspaceId: string;
  preview: ImportPreview;
}): React.JSX.Element {
  const [filter, setFilter] = useState<ChangeFilter>("all");
  const groups = useMemo(() => {
    const grouped: Record<ChangeGroupKey, ImportPreviewChange[]> = {
      added: [],
      updated: [],
      moved: [],
      archived: [],
      unchanged: [],
    };
    for (const change of preview.changes) {
      if (matchesFilter(change, filter)) grouped[groupOf(change)].push(change);
    }
    return grouped;
  }, [preview.changes, filter]);

  return (
    <div className="flex flex-col gap-4 pb-6">
      <ImportSummary preview={preview} />
      <ImportWarningSummary preview={preview} />
      <div className="flex items-center gap-2 text-sm">
        <label htmlFor="import-change-filter" className="font-medium text-kh-text-muted">
          Filter changes
        </label>
        <select
          id="import-change-filter"
          value={filter}
          onChange={(event) => setFilter(event.target.value as ChangeFilter)}
          className="rounded-md border border-kh-border bg-kh-bg px-2 py-1 text-sm text-kh-text focus:outline-none focus-visible:ring-2 focus-visible:ring-kh-accent"
        >
          {FILTER_META.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label} ({countFor(preview.changes, option.value)})
            </option>
          ))}
        </select>
      </div>
      {GROUP_META.filter((group) => filter === "all" || groups[group.key].length > 0).map((group) => (
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

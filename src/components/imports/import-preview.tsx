"use client";

import { useMemo, useState } from "react";
import type { ImportPreview } from "@/modules/sources/application/reconcile-import-snapshot";
import type { ImportPreviewChange } from "@/modules/sources/domain/import-plan";
import { ImportChangeGroup } from "@/components/imports/import-change-group";
import { ImportStickyFooter } from "@/components/imports/import-sticky-footer";
import { ImportSummary } from "@/components/imports/import-summary";
import { Select } from "@/components/ui/select";
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

/**
 * Label-based filter predicate. Unlike groupOf (display grouping with
 * precedence), every filter tests its own label(s) independently so a
 * multi-label change (e.g. ["RENAMED", "UPDATED"]) appears under each matching
 * filter — the same per-label independence summarizeImportChanges uses. The
 * option counts are not summary figures though: they count changes, while the
 * summary counts per-kind totals and diagnostics, so the two differ by unit.
 * "warnings" matches any diagnostic, BLOCKING included.
 */
export function matchesFilter(change: ImportPreviewChange, filter: ChangeFilter): boolean {
  if (filter === "all") return true;
  if (filter === "warnings") return change.diagnostics.length > 0;
  const labels = new Set(change.labels);
  if (filter === "moved") return labels.has("MOVED");
  if (filter === "renamed") return labels.has("RENAMED");
  if (filter === "added") return labels.has("ADDED");
  if (filter === "updated") return labels.has("UPDATED");
  if (filter === "archived") return labels.has("ARCHIVED") || labels.has("RESTORED") || labels.has("REMOVED");
  return false;
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
  // §19 allows 20,000 manifest entries; recomputing 7 option counts on every
  // render would be 140,000 predicate calls. They depend only on the changes.
  const counts = useMemo(
    () => FILTER_META.map((option) => countFor(preview.changes, option.value)),
    [preview.changes],
  );

  return (
    <div className="flex flex-col gap-4 pb-6">
      <ImportSummary preview={preview} />
      <ImportWarningSummary preview={preview} />
      <div className="flex items-center gap-2 text-body">
        <label htmlFor="import-change-filter" className="font-medium text-kh-text-muted">
          Filter changes
        </label>
        <Select
          id="import-change-filter"
         
          value={filter}
          onChange={(event) => setFilter(event.target.value as ChangeFilter)}
        >
          {FILTER_META.map((option, index) => (
            <option key={option.value} value={option.value}>
              {option.label} ({counts[index]})
            </option>
          ))}
        </Select>
      </div>
      {/*
        Under an explicit filter every surviving group is what the user asked
        for, so none of them start collapsed. Without this, a diagnostic-only
        change (labels: []) lands in "unchanged" and the Warnings filter would
        render it inside a collapsed group — the one row the filter exists to
        show. The filter is part of the key because ImportChangeGroup only
        reads defaultExpanded as its initial state.
      */}
      {GROUP_META.filter((group) => filter === "all" || groups[group.key].length > 0).map((group) => (
        <ImportChangeGroup
          key={`${filter}-${group.key}`}
          title={group.title}
          changes={groups[group.key]}
          defaultExpanded={filter !== "all" || group.key !== "unchanged"}
        />
      ))}
      <ImportStickyFooter workspaceId={workspaceId} preview={preview} />
    </div>
  );
}

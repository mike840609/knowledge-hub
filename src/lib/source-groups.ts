import type { SourceListItemModel } from "@/server/source-read";

export const SOURCE_GROUP_LABELS = {
  hub: "Managed in Hub",
  synced: "Synced folders",
} as const;

export type SourceGroupKey = keyof typeof SOURCE_GROUP_LABELS;

export type SourceGroup = {
  key: SourceGroupKey;
  label: (typeof SOURCE_GROUP_LABELS)[SourceGroupKey];
  items: SourceListItemModel[];
};

/**
 * The Sources page groups by how a source's content is managed, not by its
 * storage type: a single file upload and a note written in the Hub are both
 * Hub-managed. The input is already filtered and sorted, so this only splits
 * it, preserving that order inside each group.
 *
 * The caller shows the labels only when both groups are present. With one
 * kind there is nothing to distinguish, and the page keeps its plain list.
 */
export function groupSourceItems(items: readonly SourceListItemModel[]): SourceGroup[] {
  const hub = items.filter((item) => item.source.ownership === "HUB_MANAGED");
  const synced = items.filter((item) => item.source.ownership === "SOURCE_MANAGED");
  const groups: SourceGroup[] = [];
  if (hub.length > 0) {
    groups.push({ key: "hub", label: SOURCE_GROUP_LABELS.hub, items: hub });
  }
  if (synced.length > 0) {
    groups.push({ key: "synced", label: SOURCE_GROUP_LABELS.synced, items: synced });
  }
  return groups;
}

export function showSourceGroupLabels(groups: readonly SourceGroup[]): boolean {
  return groups.length > 1;
}

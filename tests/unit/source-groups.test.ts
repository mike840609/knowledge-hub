import { describe, expect, it } from "vitest";
import { groupSourceItems, showSourceGroupLabels } from "@/lib/source-groups";
import type { SourceListItemModel } from "@/server/source-read";

const item = (
  id: string,
  name: string,
  ownership: "HUB_MANAGED" | "SOURCE_MANAGED",
  sourceType: "HUB" | "FILE_UPLOAD" | "FOLDER_SYNC",
): SourceListItemModel => ({
  source: {
    id,
    workspaceId: "ws",
    name,
    sourceType,
    ownership,
    status: "ACTIVE",
    syncVersion: 1,
  },
  latestRun: null,
});

describe("groupSourceItems", () => {
  it("puts Hub-managed sources before synced folders and keeps the input order inside each group", () => {
    const groups = groupSourceItems([
      item("synced-1", "Vendor", "SOURCE_MANAGED", "FOLDER_SYNC"),
      item("hub-1", "Notes", "HUB_MANAGED", "HUB"),
      item("upload-1", "Uploads", "HUB_MANAGED", "FILE_UPLOAD"),
    ]);

    expect(groups.map((group) => group.key)).toEqual(["hub", "synced"]);
    expect(groups[0]?.label).toBe("Managed in Hub");
    expect(groups[0]?.items.map((entry) => entry.source.name)).toEqual(["Notes", "Uploads"]);
    expect(groups[1]?.label).toBe("Synced folders");
    expect(groups[1]?.items.map((entry) => entry.source.name)).toEqual(["Vendor"]);
    expect(showSourceGroupLabels(groups)).toBe(true);
  });

  it("returns one group and no labels when only one kind is present", () => {
    const hubOnly = groupSourceItems([item("hub", "Notes", "HUB_MANAGED", "HUB")]);
    expect(hubOnly).toHaveLength(1);
    expect(hubOnly[0]?.key).toBe("hub");
    expect(showSourceGroupLabels(hubOnly)).toBe(false);

    const syncedOnly = groupSourceItems([item("sync", "Vendor", "SOURCE_MANAGED", "FOLDER_SYNC")]);
    expect(syncedOnly).toHaveLength(1);
    expect(syncedOnly[0]?.key).toBe("synced");
    expect(showSourceGroupLabels(syncedOnly)).toBe(false);
  });

  it("returns no groups for an empty list", () => {
    const groups = groupSourceItems([]);
    expect(groups).toEqual([]);
    expect(showSourceGroupLabels(groups)).toBe(false);
  });
});

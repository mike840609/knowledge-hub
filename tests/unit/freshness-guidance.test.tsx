import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FreshnessReminders } from "@/components/knowledge/freshness-reminders";
import type { SourceListItemModel } from "@/server/source-read";
const source = { id: "source", name: "Folder", sourceType: "FOLDER_SYNC", ownership: "SOURCE_MANAGED", status: "ACTIVE" } as SourceListItemModel["source"];
const render = (items: SourceListItemModel[]) => renderToStaticMarkup(<FreshnessReminders workspaceId="ws" items={items} preference={{ thresholdDays: 14, version: 0 }} />);
it("omits settings without active folder sources", () => {
  expect(render([])).toBe("");
  expect(render([{ source: { ...source, sourceType: "FILE_UPLOAD" }, latestRun: null }])).toBe("");
  expect(render([{ source: { ...source, status: "ARCHIVED" }, latestRun: null }])).toBe("");
});
it("keeps settings collapsed and points freshness at the source row", () => {
  const html = render([{ source, latestRun: null }]);
  expect(html).toContain("Freshness reminder settings");
  expect(html).not.toContain("<details open");
  expect(html).toContain("marked “Stale” in the list above");
  // The folder list moved onto each source row; this panel must not repeat it.
  expect(html).not.toContain("Update from folder");
  expect(html).not.toContain("Folders to review");
});

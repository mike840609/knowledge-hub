import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FreshnessReminders } from "@/components/knowledge/freshness-reminders";
import type { SourceListItemModel } from "@/server/source-read";
const source = { id: "source", name: "Folder", sourceType: "FOLDER_SYNC", ownership: "SOURCE_MANAGED", status: "ACTIVE" } as SourceListItemModel["source"];
const render = (items: SourceListItemModel[]) => renderToStaticMarkup(<FreshnessReminders workspaceId="ws" items={items} preference={{ thresholdDays: 14, version: 0 }} now="2026-10-09T00:00:00Z" />);
it("omits reminders and settings without active folder sources", () => {
  expect(render([])).toBe("");
  expect(render([{ source: { ...source, sourceType: "FILE_UPLOAD" }, latestRun: null }])).toBe("");
  expect(render([{ source: { ...source, status: "ARCHIVED" }, latestRun: null }])).toBe("");
});
it("keeps settings collapsed and actionable reminders visible", () => {
  const html = render([{ source, latestRun: null }]);
  expect(html).toContain("Freshness reminder settings");
  expect(html).not.toContain("<details open");
  expect(html).toContain("Never imported");
  expect(html).toContain("Update from folder");
});

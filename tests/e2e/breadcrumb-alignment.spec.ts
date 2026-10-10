import { test, expect } from "./fixtures/test";
import { stageReadingFolder } from "./fixtures/folder-reading";

test("workspace page breadcrumbs share a desktop origin and document rows share its height", async ({ page, request }) => {
  test.setTimeout(120000);
  const nav = await (await request.get("/api/workspaces")).json();
  const ws = nav.items.find((item: { type: string }) => item.type === "PERSONAL").id;
  const staged = await stageReadingFolder(request, { workspaceId: ws, sourceName: "Breadcrumb test folder", fixture: "reading-flow-v1" });
  const applied = await request.post(`/api/source-imports/${staged}/apply`, { data: {} });
  expect(applied.ok()).toBe(true);
  const { sourceId, runId } = await applied.json();
  await page.setViewportSize({ width: 1440, height: 1000 });
  let origin: { x: number; y: number; height: number } | undefined;
  const routes = ["home", "graph", "sources", "shares", "profile", "search", "agent-context", "help", "sources/import", "sources/import/guide", "sources/health", `sources/${sourceId}`, `sources/${sourceId}/update`, `sources/${sourceId}/health`, "profile/articles", "profile/sync"];
  if (runId) routes.push(`sources/${sourceId}/runs/${runId}`);
  for (const route of routes) {
    await page.goto(`/w/${ws}/${route}`);
    const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb", exact: true });
    await expect(breadcrumb).toBeVisible();
    const bounds = await breadcrumb.boundingBox();
    expect(bounds).not.toBeNull();
    origin ??= bounds!;
    expect(bounds!.x, route).toBeCloseTo(origin.x, 0);
    expect(bounds!.y, route).toBeCloseTo(origin.y, 0);
    expect(bounds!.height, route).toBeCloseTo(origin.height, 0);
  }
  await page.goto(`/w/${ws}/knowledge/new`);
  const row = page.getByRole("navigation", { name: "Breadcrumb", exact: true });
  await expect(row).toBeVisible();
  const bounds = await row.boundingBox();
  expect(bounds!.y).toBeCloseTo(origin!.y, 0);
  expect(bounds!.height).toBeCloseTo(origin!.height, 0);
});

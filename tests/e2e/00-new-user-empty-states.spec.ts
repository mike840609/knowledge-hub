import { test, expect } from "./fixtures/test";
import { mkdir } from "node:fs/promises";

test("new users get actionable guidance on every empty page and can reopen Home guidance", async ({ page, request }) => {
  const nav = await (await request.get("/api/workspaces")).json();
  const ws = nav.items.find((item: { type: string }) => item.type === "PERSONAL").id;
  const endpoint = `/api/workspaces/${ws}/onboarding`;
  const initial = await (await request.get(endpoint)).json();
  expect((await request.put(endpoint, { data: { value: { schemaVersion: 1, dismissed: false }, version: initial.version } })).ok()).toBe(true);
  const output = process.env.KM_EMPTY_SCREENSHOTS ?? "docs/ui-comparisons/empty-state-guidance";
  await mkdir(output, { recursive: true });
  const pages = [
    ["knowledge", "No documents yet"],
    ["sources", "No sources yet"],
    ["search?scope=workspace", "No saved documents yet"],
    ["agent-context", "Add documents to prepare AI context"],
    ["graph", "Add documents to build your graph"],
    ["shares", "No active share links."],
    ["profile", "See your knowledge grow"],
  ] as const;
  for (const [route, heading] of pages) {
    await page.goto(`/w/${ws}/${route}`);
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    await expect(page.locator("figure")).toHaveCount(1);
    await expect(page.getByRole("link", { name: route === "knowledge" ? "Import your first knowledge source" : "Import folder", exact: true })).toBeVisible();
    for (const [name, viewport] of [["desktop", { width: 1440, height: 1000 }], ["mobile", { width: 390, height: 844 }]] as const) {
      await page.setViewportSize(viewport);
      await page.screenshot({ path: `${output}/after-${route.split("?")[0]}-${name}.png`, fullPage: false, animations: "disabled" });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/w/${ws}/updates`);
  await expect(page.getByText("Example: new and updated documents after Apply", { exact: true })).toBeVisible();
  await page.screenshot({ path: `${output}/after-updates-desktop.png`, animations: "disabled" });
  await page.getByRole("button", { name: /^Account:/ }).click();
  await page.getByRole("menuitemradio", { name: "Dark", exact: true }).click();
  await page.keyboard.press("Escape");
  for (const [route] of pages) {
    await page.goto(`/w/${ws}/${route}`);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.screenshot({ path: `${output}/after-${route.split("?")[0]}-dark.png`, animations: "disabled" });
  }
  await page.goto(`/w/${ws}/home`);
  const guide = page.getByRole("region", { name: "Get started", exact: true });
  await expect(guide.getByText("0 of 4 steps complete", { exact: false })).toBeVisible();
  await guide.getByRole("button", { name: "Hide guidance" }).click();
  await expect(guide).toHaveCount(0);
  await page.getByRole("button", { name: "Show getting started guide", exact: true }).click();
  await expect(guide).toBeVisible();
  await guide.getByRole("button", { name: "Hide guidance" }).click();
  await expect(guide).toHaveCount(0);
  await page.getByRole("button", { name: "Home actions" }).click();
  await expect(page.getByRole("menuitem", { name: "Show getting started guide", exact: true })).toBeVisible();
  await page.screenshot({ path: `${output}/after-home-menu.png`, fullPage: false, animations: "disabled" });
  await page.getByRole("menuitem", { name: "Show getting started guide", exact: true }).click();
  await expect(guide).toBeVisible();
  await page.reload();
  await expect(guide.getByText("0 of 4 steps complete", { exact: false })).toBeVisible();
});

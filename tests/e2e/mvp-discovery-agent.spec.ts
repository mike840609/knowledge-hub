import { test, expect } from "./fixtures/test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
test("source exclusions, filter-only search and reviewed Agent context", async ({ page, request }) => {
  const nav = await (await request.get("/api/workspaces")).json();
  const ws = nav.items.find((w: { type: string }) => w.type === "PERSONAL").id;
  const root = await mkdtemp(path.join(tmpdir(), "mvp-wiki-"));
  try {
    await mkdir(path.join(root, "docs")); await mkdir(path.join(root, "private"));
    await writeFile(path.join(root, "docs", "guide.md"), "# MVP guide\n\nAgent reference body.");
    await writeFile(path.join(root, "private", "secret.md"), "# Excluded secret\n\nDo not import.");
    await page.goto(`/w/${ws}/sources/import`);
    await page.getByLabel("Source name", { exact: true }).fill("MVP browser source");
    await page.getByText("Excluded paths", { exact: true }).click();
    await page.getByRole("textbox", { name: "One file or folder path per line, relative to the selected folder" }).fill("private");
    await page.locator("#import-folder").setInputFiles(root);
    await expect(page).toHaveURL(/\/sources\/imports\//);
    await page.getByRole("button", { name: "Apply changes" }).click();
    await expect(page).toHaveURL(/\/runs\//);
    const source = page.url().match(/sources\/([^/]+)\//)![1];
    const scope = await (await request.get(`/api/sources/${source}/import-scope`)).json();
    expect(scope.paths).toEqual(["private"]);
    await page.goto(`/w/${ws}/sources/${source}/update`);
    await page.getByText("Excluded paths", { exact: true }).click();
    await expect(page.getByRole("textbox", { name: "One file or folder path per line, relative to the selected folder" })).toHaveValue("private");
    await page.goto(`/w/${ws}/search?source=${source}&path=docs&sort=newest&offset=480`);
    await expect(page.getByRole("link", { name: /^MVP guide docs\/guide\.md/ })).toBeVisible();
    await expect(page.getByText("Excluded secret", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Dates are inclusive in UTC+08:00", { exact: false })).toBeVisible();
    await page.goto(`/w/${ws}/agent-context`);
    await page.getByLabel("Find documents").fill("MVP browser source");
    await page.getByRole("checkbox", { name: /Select MVP guide/ }).check();
    await page.getByRole("button", { name: "Prepare context" }).click();
    const preview = page.getByLabel("Markdown preview");
    await expect(preview).toHaveValue(/Agent reference body\./);
    // Next.js may normalize the loopback request hostname to localhost.
    const port = new URL(page.url()).port;
    await expect(preview).toHaveValue(new RegExp(`Original: http://(?:127\\.0\\.0\\.1|localhost):${port}/w/${ws}/knowledge/${source}/[a-f0-9-]+\\?revision=1`));
    await page.evaluate(() => { Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new Error("denied"); } } }); });
    await page.getByRole("button", { name: "Copy for Agent", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "copy it manually" })).toBeVisible();
    await expect(preview).toBeFocused();
    await page.getByRole("checkbox", { name: /Select MVP guide/ }).uncheck();
    await expect(preview).toHaveCount(0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

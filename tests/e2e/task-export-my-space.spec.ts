import { test, expect } from "./fixtures/test";
import { stageReadingFolder } from "./fixtures/folder-reading";

const HOSTILE = '<img src=x onerror="window.__pwned=1"> **bold** [click](javascript:alert(1))';

test("task results in My Space: export, browse, version, archive and restore, all inert", async ({ page, request }) => {
  const nav = await (await request.get("/api/workspaces")).json();
  const ws = nav.items.find((w: { type: string }) => w.type === "PERSONAL").id;
  const sourceName = `Task export ${Date.now()}`;
  const snapshot = await stageReadingFolder(request, { workspaceId: ws, sourceName, fixture: "task-export-my-space" });
  expect((await request.post(`/api/source-imports/${snapshot}/apply`, { data: {} })).ok()).toBe(true);

  // Discoverable from home, with no new sidebar entry.
  await page.goto(`/w/${ws}/home`);
  await expect(page.locator(`nav a[href="/w/${ws}/tasks"]`)).toHaveCount(0);
  await page.getByRole("button", { name: "Home actions" }).click();
  await page.getByRole("menuitem", { name: "Tasks from coding agents" }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${ws}/tasks$`));
  await expect(page.getByRole("heading", { name: "Tasks", exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Set up export" }).click();
  await page.getByLabel("Label").fill("e2e laptop");
  await page.getByRole("button", { name: "Create binding" }).click();
  const token = await page.getByLabel("Export token").inputValue();

  // One setup line, once per machine, installing the CLI this Hub serves.
  const origin = new URL(page.url()).origin;
  const setupLine = await page.locator("pre").innerText();
  expect(setupLine).toContain(`npm install -g ${origin}/cli/knowledge-hub.tgz && knowledge-hub install-agent && knowledge-hub configure --hub-url ${origin} --binding-id `);
  expect(setupLine).toContain("--allow-insecure-localhost");
  expect(setupLine).not.toContain("checkout");
  const tarball = await request.get("/cli/knowledge-hub.tgz");
  expect(tarball.status()).toBe(200);
  expect([...(await tarball.body()).subarray(0, 2)]).toEqual([0x1f, 0x8b]);

  const taskId = crypto.randomUUID();
  const first = {
    schemaVersion: 1, taskId, artifactRevision: 1, agent: "claude-code", status: "completed",
    title: "Ünïcödé 任務 ✅", summary: HOSTILE, completedAt: "2026-11-04T10:00:00Z",
    verification: { status: "passed", checks: ["npm test: 3 passed"] },
    findings: ["data:text/html,<script>alert(1)</script>"],
    references: [{ type: "WIKI", path: "space-guide.md" }, { type: "WIKI", path: "missing.md" }, { type: "PR_URL", url: "https://github.com/o/r/pull/1" }],
  };
  const ingest = (body: unknown) => request.post("/api/task-results/ingest", { headers: { "x-knowledge-hub-export-token": token }, data: body });
  const created = await ingest(first);
  expect(created.status()).toBe(201);
  const { url } = await created.json();
  expect((await ingest({ ...first, artifactRevision: 2, title: "Ünïcödé 任務 v2" })).status()).toBe(201);

  await page.goto(url);
  await expect(page.getByRole("heading", { name: "Ünïcödé 任務 v2" })).toBeVisible();
  await expect(page.getByText(HOSTILE, { exact: true })).toBeVisible();
  await expect(page.getByText("data:text/html,<script>alert(1)</script>", { exact: true })).toBeVisible();
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  const hrefs = await page.locator("a[href]").evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""));
  for (const href of hrefs) expect(href).not.toMatch(/^\s*(?:javascript|data|vbscript):/i);

  await expect(page.getByRole("link", { name: "Space guide" })).toHaveAttribute("href", new RegExp(`^/w/${ws}/knowledge/[0-9a-f-]+/[0-9a-f-]+$`));
  await expect(page.getByText("missing.md")).toBeVisible();
  await expect(page.getByRole("link", { name: "https://github.com/o/r/pull/1" })).toHaveAttribute("target", "_blank");

  await page.getByRole("link", { name: "Revision 1" }).click();
  await expect(page.getByRole("heading", { name: "Ünïcödé 任務 ✅" })).toBeVisible();
  await expect(page.getByText("You are viewing revision 1 of 2.")).toBeVisible();

  await page.getByRole("button", { name: "Archive" }).click();
  await expect(page.getByRole("button", { name: "Restore" })).toBeVisible();
  expect((await ingest({ ...first, artifactRevision: 3 })).status()).toBe(409);
  await page.goto(`/w/${ws}/tasks`);
  await expect(page.getByRole("link", { name: /Ünïcödé 任務 v2/ })).toHaveCount(0);
  await page.getByRole("link", { name: "Archived" }).click();
  await page.getByRole("link", { name: /Ünïcödé 任務 v2/ }).click();
  await page.getByRole("button", { name: "Restore" }).click();
  await expect(page.getByRole("button", { name: "Archive" })).toBeVisible();
  expect((await ingest({ ...first, artifactRevision: 3 })).status()).toBe(201);

  // Readable at phone width without sideways scrolling.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole("button", { name: "Archive" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  const missing = await page.goto(`/w/${ws}/tasks/${crypto.randomUUID()}`);
  expect(missing?.status()).toBe(404);
});
